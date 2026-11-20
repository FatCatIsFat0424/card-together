import type { BattleshipOptions } from '@shared/rules/battleship';
import { BS_CELLS, BS_SHIPS, BS_SHIP_LENGTH, bsAround, bsShipCells } from '@shared/rules/battleship';
import type { BattleshipVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { mixedFleet } from './battleship-fleet';
import {
  fleetAction, hardShot, onTurn, owesFleet, shootAction, targetKnowledge,
} from './battleship-strategy';
import type { BsTargetKnowledge } from './battleship-strategy';
import type { SearchContext } from './search/search-types';

// Whole-fleet sampling for Battleship. Instead of counting placements ship by ship, the bot draws complete
// fleets that agree with everything its own shots revealed (misses, sunk ships, unexplained hits, and the
// touching rule), weighted so that every consistent fleet is equally likely, and fires at the cell that holds
// a ship in the largest share of them.

interface ShipPlacements {
  readonly length: number;
  readonly count: number;
  /** Cells of every placement, `length` per placement */
  readonly cells: Uint8Array;
  /** Placement indices covering each cell */
  readonly covering: readonly Int32Array[];
}

const PLACEMENTS: readonly ShipPlacements[] = BS_SHIPS.map((ship) => {
  const length = BS_SHIP_LENGTH[ship];
  const lists: number[][] = [];
  for (let cell = 0; cell < BS_CELLS; cell++) {
    for (const vertical of [false, true]) {
      const cells = bsShipCells(ship, { cell, vertical });
      if (cells) lists.push(cells);
    }
  }
  const covering: number[][] = Array.from({ length: BS_CELLS }, () => []);
  lists.forEach((cells, index) => { for (const cell of cells) covering[cell].push(index); });
  return {
    length, count: lists.length, cells: Uint8Array.from(lists.flat()), covering: covering.map((list) => Int32Array.from(list)),
  };
});

const AROUND: readonly Int8Array[] = Array.from({ length: BS_CELLS }, (_, cell) => Int8Array.from(bsAround(cell)));

/** What the weighted samples say about the opponent's sea. */
export interface FleetSampling {
  /** Weighted share of consistent fleets with a ship on each cell */
  readonly probability: Float64Array;
  /** Complete fleets drawn */
  readonly samples: number;
}

interface Sampler {
  readonly occupied: Uint8Array;
  readonly forbidden: Uint8Array;
  readonly choices: Int32Array;
}

function newSampler(): Sampler {
  return {
    occupied: new Uint8Array(BS_CELLS), forbidden: new Uint8Array(BS_CELLS),
    choices: new Int32Array(PLACEMENTS.reduce((sum, ship) => sum + ship.count, 0)),
  };
}

function fits(ship: ShipPlacements, index: number, blocked: Uint8Array, sampler: Sampler, touching: boolean): boolean {
  const base = index * ship.length;
  for (let step = 0; step < ship.length; step++) {
    const cell = ship.cells[base + step];
    if (blocked[cell] || sampler.occupied[cell] || (touching && sampler.forbidden[cell])) return false;
  }
  return true;
}

function put(ship: ShipPlacements, index: number, sampler: Sampler, noTouching: boolean): void {
  const base = index * ship.length;
  for (let step = 0; step < ship.length; step++) {
    const cell = ship.cells[base + step];
    sampler.occupied[cell] = 1;
    if (noTouching) {
      sampler.forbidden[cell] = 1;
      for (const near of AROUND[cell]) sampler.forbidden[near] = 1;
    }
  }
}

/**
 * Draws weighted fleets for the ships still afloat. A fleet is built by first covering every unexplained hit
 * (each hit takes the one ship that holds it) and then placing the other ships anywhere they fit; weighting
 * a fleet by the number of choices met on the way makes the draw uniform over consistent fleets.
 */
export function sampleFleets(
  knowledge: BsTargetKnowledge, options: BattleshipOptions, random: () => number,
  limit: { readonly maxSamples: number; readonly expired: () => boolean },
): FleetSampling {
  const blocked = new Uint8Array(BS_CELLS);
  for (const cell of knowledge.blocked) blocked[cell] = 1;
  const afloat = knowledge.afloat.map((ship) => BS_SHIPS.indexOf(ship));
  const hits = knowledge.openHits;
  const probability = new Float64Array(BS_CELLS);
  const sampler = newSampler();
  const placed: number[] = new Array<number>(afloat.length).fill(-1);
  let samples = 0;
  let totalWeight = 0;
  let attempts = 0;
  while (samples < limit.maxSamples && (samples < 1 || !limit.expired()) && attempts < limit.maxSamples * 20) {
    attempts++;
    sampler.occupied.fill(0);
    sampler.forbidden.fill(0);
    placed.fill(-1);
    let weight = 1;
    let ok = true;
    for (const hit of hits) {
      if (sampler.occupied[hit]) continue;
      let count = 0;
      for (let slot = 0; slot < afloat.length; slot++) {
        if (placed[slot] >= 0) continue;
        const ship = PLACEMENTS[afloat[slot]];
        for (const index of ship.covering[hit]) {
          if (fits(ship, index, blocked, sampler, options.noTouching)) sampler.choices[count++] = slot * 4096 + index;
        }
      }
      if (count === 0) {
        ok = false;
        break;
      }
      const choice = sampler.choices[Math.min(count - 1, Math.floor(random() * count))];
      const slot = Math.floor(choice / 4096);
      placed[slot] = choice % 4096;
      put(PLACEMENTS[afloat[slot]], placed[slot], sampler, options.noTouching);
      weight *= count;
    }
    if (!ok) continue;
    for (let slot = 0; slot < afloat.length && ok; slot++) {
      if (placed[slot] >= 0) continue;
      const ship = PLACEMENTS[afloat[slot]];
      let count = 0;
      for (let index = 0; index < ship.count; index++) {
        if (fits(ship, index, blocked, sampler, options.noTouching)) sampler.choices[count++] = index;
      }
      if (count === 0) {
        ok = false;
        break;
      }
      placed[slot] = sampler.choices[Math.min(count - 1, Math.floor(random() * count))];
      put(ship, placed[slot], sampler, options.noTouching);
      weight *= count;
    }
    if (!ok) continue;
    for (let cell = 0; cell < BS_CELLS; cell++) if (sampler.occupied[cell]) probability[cell] += weight;
    totalWeight += weight;
    samples++;
  }
  if (totalWeight > 0) for (let cell = 0; cell < BS_CELLS; cell++) probability[cell] /= totalWeight;
  return { probability, samples };
}

/** The unshot cell most likely to hold a ship, ties (within sampling noise) broken at random. */
export function likeliestCell(
  probability: Float64Array, shot: ReadonlySet<number>, random: () => number,
): number | null {
  let best = -1;
  let choices: number[] = [];
  for (let cell = 0; cell < BS_CELLS; cell++) {
    if (shot.has(cell)) continue;
    const value = probability[cell];
    if (value > best + 1e-12) {
      best = value;
      choices = [cell];
    } else if (value > best - 1e-12) {
      choices.push(cell);
    }
  }
  return choices.length === 0 ? null : choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}

/** Fleets drawn per shot at most; more samples change the choice only among cells of nearly equal chance. */
const MAX_SAMPLES = 8000;
/** Fewer fleets than this say too little, and the density count decides instead. */
const MIN_SAMPLES = 50;

/** Search strategy: a mixed-strategy fleet when placing, otherwise the cell most likely to hold a ship. */
export function battleshipSearch(visible: BattleshipVisibleState, context: SearchContext): BotAction | null {
  if (owesFleet(visible)) return fleetAction(mixedFleet(visible.options, context.random));
  if (!onTurn(visible)) return null;
  const knowledge = targetKnowledge(visible);
  const sampling = sampleFleets(knowledge, visible.options, context.random, {
    maxSamples: MAX_SAMPLES, expired: context.budget.expired,
  });
  const cell = sampling.samples >= MIN_SAMPLES ? likeliestCell(sampling.probability, knowledge.shot, context.random) : null;
  const shot = cell ?? hardShot(knowledge, context.random);
  return shot === null ? null : shootAction(shot);
}
