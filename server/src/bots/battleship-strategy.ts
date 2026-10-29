import type { BattleshipVisibleState, GameSeat } from '@shared/types';
import {
  BS_CELLS, BS_SHIPS, bsAround, bsCell, bsCol, bsContacts, bsNode, bsOrthogonal, bsRandomFleet, bsRow, bsShipCells,
} from '@shared/rules/battleship';
import type { BsPlacement, BsShip } from '@shared/rules/battleship';
import type { BotAction } from './bot-decisions';

/** Random fleets the hard bot compares, keeping the most spread out. */
const SPREAD_SAMPLES = 12;

/** How much more a placement counts for each unresolved hit it covers. */
const HIT_WEIGHT = 40;

/** Hunting density kept on the off-parity cells; ships of two or more always cover a parity cell. */
const OFF_PARITY = 0.55;

/** One fixed legal fleet, each ship in its own even row, which also keeps ships apart. */
const FALLBACK_FLEET: readonly BsPlacement[] = BS_SHIPS.map((_, index) => ({ cell: index * 20, vertical: false }));

/** What the seat knows about the opponent's sea from its own shots. */
export interface BsTargetKnowledge {
  /** Cells shot already */
  readonly shot: ReadonlySet<number>;
  /** Cells known to hold no ship that is still afloat: misses, sunk ships, and (no touching) their surroundings */
  readonly blocked: ReadonlySet<number>;
  /** Hits not yet explained by a sunk ship */
  readonly openHits: readonly number[];
  /** Ships still afloat */
  readonly afloat: readonly BsShip[];
}

function shootAction(cell: number): BotAction {
  return { type: 'game-action', request: { gameType: 'battleship', action: { type: 'fire', to: bsNode(cell) } } };
}

function fleetAction(fleet: readonly BsPlacement[]): BotAction {
  return { type: 'game-action', request: { gameType: 'battleship', action: { type: 'place-fleet', fleet: fleet.map((ship) => ({ ...ship })) } } };
}

function seated(visible: BattleshipVisibleState): boolean {
  return visible.seats.includes(visible.mySeat);
}

function owesFleet(visible: BattleshipVisibleState): boolean {
  return visible.phase === 'placing' && seated(visible) && !visible.placed.includes(visible.mySeat);
}

function onTurn(visible: BattleshipVisibleState): boolean {
  return visible.phase === 'playing' && seated(visible) && visible.currentTurnSeat === visible.mySeat;
}

/** The seat's knowledge of the opponent's sea, from the public results of its own shots only. */
export function targetKnowledge(visible: BattleshipVisibleState, seat: GameSeat = visible.mySeat): BsTargetKnowledge {
  const shot = new Set<number>();
  const hits: number[] = [];
  const sunkCells = new Set<number>();
  const sunk: BsShip[] = [];
  const blocked = new Set<number>();
  for (const entry of visible.log) {
    if (entry.seat !== seat) continue;
    const cell = bsCell(entry.to)!;
    shot.add(cell);
    if (entry.result === 'miss') blocked.add(cell);
    else hits.push(cell);
    if (entry.ship) sunk.push(entry.ship);
    for (const node of entry.sunkCells ?? []) sunkCells.add(bsCell(node)!);
  }
  for (const cell of sunkCells) {
    blocked.add(cell);
    if (visible.options.noTouching) for (const near of bsAround(cell)) blocked.add(near);
  }
  return {
    shot, blocked,
    openHits: hits.filter((cell) => !sunkCells.has(cell)),
    afloat: BS_SHIPS.filter((ship) => !sunk.includes(ship)),
  };
}

/** Unshot cells, in sea order. */
function openCells(knowledge: BsTargetKnowledge): number[] {
  return Array.from({ length: BS_CELLS }, (_, cell) => cell).filter((cell) => !knowledge.shot.has(cell));
}

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length)];

/**
 * How many placements of the ships still afloat cover each cell, given the misses, sunk ships, and open hits.
 * While a hit is unresolved, placements through it count far more, so the bot finishes the ship (target mode);
 * otherwise it hunts on a checkerboard, which every ship of two or more cells must cross.
 */
export function shotDensity(knowledge: BsTargetKnowledge): number[] {
  const density = new Array<number>(BS_CELLS).fill(0);
  const open = new Set(knowledge.openHits);
  const targeting = open.size > 0;
  for (const ship of knowledge.afloat) {
    for (let cell = 0; cell < BS_CELLS; cell++) {
      for (const vertical of [false, true]) {
        const cells = bsShipCells(ship, { cell, vertical });
        if (!cells || cells.some((part) => knowledge.blocked.has(part))) continue;
        const covered = cells.filter((part) => open.has(part)).length;
        if (targeting && covered === 0) continue;
        const weight = HIT_WEIGHT ** covered;
        for (const part of cells) if (!knowledge.shot.has(part)) density[part] += weight;
      }
    }
  }
  if (!targeting) {
    for (let cell = 0; cell < BS_CELLS; cell++) if ((bsCol(cell) + bsRow(cell)) % 2 === 1) density[cell] *= OFF_PARITY;
  }
  return density;
}

/** The densest unshot cell, ties broken at random. */
export function hardShot(knowledge: BsTargetKnowledge, random: () => number): number | null {
  const density = shotDensity(knowledge);
  const cells = openCells(knowledge);
  if (cells.length === 0) return null;
  let best = -1;
  let choices: number[] = [];
  for (const cell of cells) {
    if (density[cell] > best) {
      best = density[cell];
      choices = [cell];
    } else if (density[cell] === best) {
      choices.push(cell);
    }
  }
  // No placement fits what was seen (hits of ships lying side by side), so follow up the hits directly.
  return best > 0 ? pick(choices, random) : easyShot(knowledge, random);
}

/** A random unshot cell, except that after a hit it tries a random unshot neighbour of an open hit. */
export function easyShot(knowledge: BsTargetKnowledge, random: () => number): number | null {
  const follow = knowledge.openHits.flatMap(bsOrthogonal).filter((cell) => !knowledge.shot.has(cell));
  if (follow.length > 0) return pick(follow, random);
  const cells = openCells(knowledge);
  return cells.length > 0 ? pick(cells, random) : null;
}

/** The most spread-out of a few random fleets, so a hit rarely leads straight to a neighbouring ship. */
export function spreadFleet(visible: Pick<BattleshipVisibleState, 'options'>, random: () => number): BsPlacement[] {
  let best: { fleet: BsPlacement[]; contacts: number } | null = null;
  for (let sample = 0; sample < SPREAD_SAMPLES; sample++) {
    const fleet = bsRandomFleet(random, visible.options);
    const contacts = bsContacts(fleet);
    if (!best || contacts < best.contacts) best = { fleet, contacts };
  }
  return best!.fleet;
}

/** Easy: a random fleet, then random shots with a simple follow-up after a hit. Also a timed-out player's shot. */
export function easyBattleshipAction(visible: BattleshipVisibleState, random: () => number): BotAction | null {
  if (owesFleet(visible)) return fleetAction(bsRandomFleet(random, visible.options));
  if (!onTurn(visible)) return null;
  const cell = easyShot(targetKnowledge(visible), random);
  return cell === null ? null : shootAction(cell);
}

/** Hard: a spread-out fleet, then probability-density hunting and target mode from its own shot results. */
export function getBattleshipBotAction(visible: BattleshipVisibleState, random: () => number): BotAction | null {
  if (owesFleet(visible)) return fleetAction(spreadFleet(visible, random));
  if (!onTurn(visible)) return null;
  const cell = hardShot(targetKnowledge(visible), random);
  return cell === null ? null : shootAction(cell);
}

/** A fixed fleet or the first unshot cell: the last resort when the strategies keep failing. */
export function battleshipFirstLegalAction(visible: BattleshipVisibleState): BotAction | null {
  if (owesFleet(visible)) return fleetAction(FALLBACK_FLEET);
  if (!onTurn(visible)) return null;
  const [cell] = openCells(targetKnowledge(visible));
  return cell === undefined ? null : shootAction(cell);
}

/** A human who missed the placement deadline gets the same random fleet as the 隨機擺放 button. */
export function autoPlaceAction(visible: BattleshipVisibleState, random: () => number): BotAction | null {
  return owesFleet(visible) ? fleetAction(bsRandomFleet(random, visible.options)) : null;
}
