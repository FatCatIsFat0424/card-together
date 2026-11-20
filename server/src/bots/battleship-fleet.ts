import { BS_CELLS, BS_SHIPS, BS_SIZE, bsContacts, bsRandomFleet, bsShipCells } from '@shared/rules/battleship';
import type { BattleshipOptions, BsPlacement } from '@shared/rules/battleship';

// Fleet placement as a mixed strategy. A shooter that assumes every legal fleet is equally likely looks hardest
// at the middle of the sea, so fleets that lean toward the edges take it longer to find, and ships that touch
// look like one long ship once hit, which costs it more shots. How strongly a fleet leans is drawn per game, so
// no single layout style can be learned from the bot's fleets, and a shooter that assumes the lean of one game
// loses most of that assumption in the next.

/** Random legal fleets compared per placement. */
const POOL_SIZE = 240;

/** Strongest lean toward the edges, in log-likelihood per ring of distance from the centre and ship cell. */
const EDGE_PULL_MAX = 0.6;

/** Log-likelihood gained per pair of touching cells of different ships. */
const CONTACT_BONUS = 0.25;

const CENTRE = (BS_SIZE - 1) / 2;

/** Rings (0.5 next to the centre to 4.5 on the border) of a cell's distance from the centre of the sea. */
const ring = (cell: number): number =>
  Math.max(Math.abs((cell % BS_SIZE) - CENTRE), Math.abs(Math.floor(cell / BS_SIZE) - CENTRE));

const RING_OFFSET = Array.from({ length: BS_CELLS }, (_, cell) => ring(cell) - 2.5);

/** A legal fleet drawn from random fleets, favouring edges by this game's pull and touching ships. */
export function mixedFleet(options: BattleshipOptions, random: () => number): BsPlacement[] {
  const pull = random() * EDGE_PULL_MAX;
  const pool: { fleet: BsPlacement[]; logWeight: number }[] = [];
  for (let sample = 0; sample < POOL_SIZE; sample++) {
    const fleet = bsRandomFleet(random, options);
    let edge = 0;
    fleet.forEach((placement, index) => {
      for (const cell of bsShipCells(BS_SHIPS[index], placement)!) edge += RING_OFFSET[cell];
    });
    pool.push({ fleet, logWeight: pull * edge + CONTACT_BONUS * bsContacts(fleet) });
  }
  const top = Math.max(...pool.map((entry) => entry.logWeight));
  const weights = pool.map((entry) => Math.exp(entry.logWeight - top));
  let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < pool.length; index++) {
    ticket -= weights[index];
    if (ticket <= 0) return pool[index].fleet;
  }
  return pool[pool.length - 1].fleet;
}
