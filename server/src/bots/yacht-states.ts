// ─── Yacht Dice solitaire states: the compact index shared by the table generator and the bot ───

import {
  YACHT_BOXES, YACHT_EXTRA_BONUS, YACHT_FULL_HOUSE, YACHT_LARGE_STRAIGHT, YACHT_SMALL_STRAIGHT, YACHT_UPPER_BONUS,
  YACHT_UPPER_BONUS_TARGET, YACHT_YACHT,
} from '@shared/rules/yacht';
import type { YachtScorecard } from '@shared/rules/yacht';
import type { YachtDiceTables } from './yacht-dice';

/** Box positions follow `YACHT_BOXES`: 0-5 are ones to sixes, 11 is the Yacht box. */
export const UPPER_COUNT = 6;
export const LOWER_COUNT = 7;
export const YACHT_BIT = 11;
export const FULL_MASK = (1 << YACHT_BOXES.length) - 1;
const UPPER_MASK = (1 << UPPER_COUNT) - 1;
const UPPER_LEVELS = YACHT_UPPER_BONUS_TARGET + 1;
const YACHT_LOWER_BIT = YACHT_BIT - UPPER_COUNT;
const FULL_HOUSE_BOX = YACHT_BOXES.indexOf('fullHouse');
const SMALL_STRAIGHT_BOX = YACHT_BOXES.indexOf('smallStraight');
const LARGE_STRAIGHT_BOX = YACHT_BOXES.indexOf('largeStraight');

/** The Yacht box of a state: still empty (0), written with 0 (1), or written with 50 so later Yachts are jokers (2). */
export type YachtFlag = 0 | 1 | 2;

/**
 * A solitaire state is the filled boxes, the Yacht box status and the upper subtotal. The subtotal is
 * canonical: 63 once the bonus is secured and 0 once it is out of reach, so equivalent states share one entry.
 */
export function canonicalUpper(upperMask: number, subtotal: number): number {
  if (subtotal >= YACHT_UPPER_BONUS_TARGET) return YACHT_UPPER_BONUS_TARGET;
  let room = 0;
  for (let face = 1; face <= UPPER_COUNT; face += 1) if (!(upperMask & (1 << (face - 1)))) room += 5 * face;
  return subtotal + room < YACHT_UPPER_BONUS_TARGET ? 0 : subtotal;
}

/** Canonical subtotals each set of filled upper boxes can hold, sorted. */
const upperLevels: number[][] = [];
/** Per upper mask and canonical subtotal: position among that mask's levels, or -1. */
const upperIndex = new Int16Array((1 << UPPER_COUNT) * UPPER_LEVELS).fill(-1);
/** Per upper mask: first entry of its levels in the flat level list. */
const upperBase = new Int32Array((1 << UPPER_COUNT) + 1);
/** Per lower mask (boxes 6 to 12): first state slot; the Yacht box takes a second slot once filled. */
const lowerBase = new Int32Array((1 << LOWER_COUNT) + 1);

for (let mask = 0; mask <= UPPER_MASK; mask += 1) {
  let sums = new Set<number>([0]);
  for (let face = 1; face <= UPPER_COUNT; face += 1) {
    if (!(mask & (1 << (face - 1)))) continue;
    const next = new Set<number>();
    for (const sum of sums) for (let count = 0; count <= 5; count += 1) next.add(sum + count * face);
    sums = next;
  }
  const levels = [...new Set([...sums].map((sum) => canonicalUpper(mask, sum)))].sort((a, b) => a - b);
  upperLevels.push(levels);
  levels.forEach((level, index) => { upperIndex[mask * UPPER_LEVELS + level] = index; });
  upperBase[mask + 1] = upperBase[mask] + levels.length;
}
for (let mask = 0; mask < (1 << LOWER_COUNT); mask += 1) {
  lowerBase[mask + 1] = lowerBase[mask] + (mask & (1 << YACHT_LOWER_BIT) ? 2 : 1);
}

const LOWER_SLOTS = lowerBase[1 << LOWER_COUNT];

/** How many solitaire states the table holds. */
export const YACHT_STATE_COUNT = upperBase[1 << UPPER_COUNT] * LOWER_SLOTS;

/** Position of a state in the flat table. A subtotal no play can reach snaps to the nearest one below. */
export function stateIndex(mask: number, flag: YachtFlag, subtotal: number): number {
  const upperMask = mask & UPPER_MASK;
  let level = canonicalUpper(upperMask, subtotal);
  let position = upperIndex[upperMask * UPPER_LEVELS + level];
  if (position < 0) {
    const levels = upperLevels[upperMask];
    level = levels.reduce((best, candidate) => (candidate <= level ? candidate : best), levels[0]);
    position = upperIndex[upperMask * UPPER_LEVELS + level];
  }
  const slot = lowerBase[mask >> UPPER_COUNT] + (flag === 2 ? 1 : 0);
  return (upperBase[upperMask] + position) * LOWER_SLOTS + slot;
}

/** Visits every state in the table. */
export function forEachState(visit: (mask: number, flag: YachtFlag, subtotal: number, index: number) => void): void {
  for (let mask = 0; mask <= FULL_MASK; mask += 1) {
    const flags: readonly YachtFlag[] = mask & (1 << YACHT_BIT) ? [1, 2] : [0];
    for (const level of upperLevels[mask & UPPER_MASK]) {
      for (const flag of flags) visit(mask, flag, level, stateIndex(mask, flag, level));
    }
  }
}

/** The solitaire state of a scorecard. */
export function cardState(card: YachtScorecard): { mask: number; flag: YachtFlag; subtotal: number } {
  let mask = 0;
  let subtotal = 0;
  YACHT_BOXES.forEach((box, index) => {
    const score = card.boxes[box];
    if (score === undefined) return;
    mask |= 1 << index;
    if (index < UPPER_COUNT) subtotal += score;
  });
  const flag: YachtFlag = card.boxes.yacht === undefined ? 0 : card.boxes.yacht === YACHT_YACHT ? 2 : 1;
  return { mask, flag, subtotal };
}

/**
 * Visits every box the dice (a five-dice hold id) may be written into from a state: the box position, the
 * points it adds (score, upper bonus when this write earns it, and 100 for a joker's extra Yacht) and the
 * state it leads to.
 */
export function forEachPlacement(
  dice: YachtDiceTables,
  hold: number,
  mask: number,
  flag: YachtFlag,
  subtotal: number,
  visit: (box: number, points: number, nextMask: number, nextFlag: YachtFlag, nextSubtotal: number) => void,
): void {
  const scores = dice.boxScores[hold];
  const face = dice.yachtFace[hold];
  const joker = flag === 2 && face > 0;
  let from: number = 0;
  let to: number = YACHT_BOXES.length;
  if (joker && !(mask & (1 << (face - 1)))) {
    from = face - 1;
    to = face;
  } else if (joker && mask >> UPPER_COUNT !== (1 << LOWER_COUNT) - 1) {
    from = UPPER_COUNT;
  } else if (joker) {
    to = UPPER_COUNT;
  }
  for (let box = from; box < to; box += 1) {
    if (mask & (1 << box)) continue;
    let score = scores[box];
    if (joker) {
      if (box === FULL_HOUSE_BOX) score = YACHT_FULL_HOUSE;
      else if (box === SMALL_STRAIGHT_BOX) score = YACHT_SMALL_STRAIGHT;
      else if (box === LARGE_STRAIGHT_BOX) score = YACHT_LARGE_STRAIGHT;
    }
    let points = score + (joker ? YACHT_EXTRA_BONUS : 0);
    let nextSubtotal = subtotal;
    if (box < UPPER_COUNT) {
      nextSubtotal += score;
      if (subtotal < YACHT_UPPER_BONUS_TARGET && nextSubtotal >= YACHT_UPPER_BONUS_TARGET) points += YACHT_UPPER_BONUS;
    }
    const nextMask = mask | (1 << box);
    const nextFlag: YachtFlag = box === YACHT_BIT ? (score === YACHT_YACHT ? 2 : 1) : flag;
    visit(box, points, nextMask, nextFlag, canonicalUpper(nextMask & UPPER_MASK, nextSubtotal));
  }
}
