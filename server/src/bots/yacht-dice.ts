// ─── Yacht Dice dice combinatorics: every multiset of up to five dice, its rerolls and its box scores ───

import { YACHT_BOXES, YACHT_DICE, yachtBoxScore } from '@shared/rules/yacht';
import type { YachtFace } from '@shared/rules/yacht';

/** A multiset of dice as how many dice show each face 1 to 6. */
export type Counts = readonly number[];

export interface YachtDiceTables {
  /** Every multiset of up to five dice a player can keep, ordered by size */
  readonly holds: readonly Counts[];
  /** Hold ids of the five-dice multisets, the dice a roll can show */
  readonly full: Int32Array;
  /** Hold id by `holdKey` */
  readonly holdId: Int32Array;
  /** Per hold: the five-dice multisets its reroll can reach, and their probabilities */
  readonly reach: readonly { readonly ids: Int32Array; readonly chance: Float64Array }[];
  /** Per hold id: the smaller holds a five-dice multiset contains, without itself; empty for other ids */
  readonly keeps: readonly Int32Array[];
  /** Per hold id: what the dice score in each box before the joker rule; zero for other ids */
  readonly boxScores: readonly Int32Array[];
  /** Per hold id: the sum of the dice */
  readonly sums: Int32Array;
  /** Per hold id: the face all five dice show, or 0 */
  readonly yachtFace: Int32Array;
}

/** Dense key of a multiset of faces; counts are 0 to 5, so 6 digits of base 6 index it. */
export const holdKey = (counts: Counts): number => counts.reduce((total, count) => total * 6 + count, 0);

/** Every way to give `total` dice to the faces from `from` on. */
function distributions(total: number, from = 0): number[][] {
  if (from === 5) return [[...Array(5).fill(0), total]];
  const result: number[][] = [];
  for (let count = 0; count <= total; count += 1) {
    for (const rest of distributions(total - count, from + 1)) {
      rest[from] = count;
      result.push(rest);
    }
  }
  return result;
}

const FACTORIAL = [1, 1, 2, 6, 24, 120];

export function diceOf(counts: Counts): YachtFace[] {
  return counts.flatMap((count, face) => Array<YachtFace>(count).fill((face + 1) as YachtFace));
}

function build(): YachtDiceTables {
  const holds: Counts[] = [];
  for (let size = 0; size <= YACHT_DICE; size += 1) holds.push(...distributions(size));
  const holdId = new Int32Array(6 ** 6).fill(-1);
  holds.forEach((counts, id) => { holdId[holdKey(counts)] = id; });
  const sizeOf = (counts: Counts): number => counts.reduce((a, b) => a + b, 0);
  const full = Int32Array.from(holds.flatMap((counts, id) => (sizeOf(counts) === YACHT_DICE ? [id] : [])));
  const reach = holds.map((counts) => {
    const rolled = YACHT_DICE - sizeOf(counts);
    const outcomes = distributions(rolled);
    const ids = new Int32Array(outcomes.length);
    const chance = new Float64Array(outcomes.length);
    outcomes.forEach((outcome, index) => {
      ids[index] = holdId[holdKey(counts.map((count, face) => count + outcome[face]))];
      chance[index] = FACTORIAL[rolled] / outcome.reduce((product, count) => product * FACTORIAL[count], 1) / 6 ** rolled;
    });
    return { ids, chance };
  });
  const fullSet = new Set(full);
  const keeps = holds.map((counts, id) => {
    const kept: number[] = [];
    if (fullSet.has(id)) {
      for (let size = 0; size < YACHT_DICE; size += 1) {
        for (const subset of distributions(size)) {
          if (subset.every((count, face) => count <= counts[face])) kept.push(holdId[holdKey(subset)]);
        }
      }
    }
    return Int32Array.from(kept);
  });
  const boxScores = holds.map((counts, id) => {
    const scores = new Int32Array(YACHT_BOXES.length);
    if (fullSet.has(id)) {
      const dice = diceOf(counts);
      YACHT_BOXES.forEach((box, index) => { scores[index] = yachtBoxScore(box, dice); });
    }
    return scores;
  });
  const sums = Int32Array.from(holds.map((counts) => counts.reduce((total, count, face) => total + count * (face + 1), 0)));
  const yachtFace = Int32Array.from(holds.map((counts) => (sizeOf(counts) === YACHT_DICE && counts.includes(YACHT_DICE)
    ? counts.indexOf(YACHT_DICE) + 1 : 0)));
  return { holds, full, holdId, reach, keeps, boxScores, sums, yachtFace };
}

let cached: YachtDiceTables | null = null;

export function yachtDiceTables(): YachtDiceTables {
  cached ??= build();
  return cached;
}
