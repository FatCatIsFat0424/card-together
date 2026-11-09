// ─── Yacht Dice lookahead: the best dice to keep, valued by exact expectation over the rolls left ───

import { YACHT_DICE } from '@shared/rules/yacht';
import type { YachtBox, YachtFace, YachtScorecard } from '@shared/rules/yacht';
import { yachtBestPlacement } from '@shared/rules/yacht-value';

/** A multiset of dice as how many dice show each face 1 to 6. */
type Counts = readonly number[];

interface Tables {
  /** Every multiset of up to five dice a player can keep */
  readonly holds: readonly Counts[];
  /** Hold id of each five-dice multiset */
  readonly full: readonly number[];
  readonly holdId: ReadonlyMap<number, number>;
  /** Per hold: the five-dice multisets its reroll can reach, and their probabilities */
  readonly reach: readonly { readonly ids: Int32Array; readonly chance: Float64Array }[];
  /** Per hold id of a five-dice multiset: the smaller holds it contains, without itself; empty for other ids */
  readonly keeps: readonly Int32Array[];
}

const key = (counts: Counts): number => counts.reduce((total, count) => total * 6 + count, 0);

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

let cached: Tables | null = null;

function tables(): Tables {
  if (cached) return cached;
  const holds: Counts[] = [];
  for (let size = 0; size <= YACHT_DICE; size += 1) holds.push(...distributions(size));
  const holdId = new Map(holds.map((counts, id) => [key(counts), id]));
  const full = holds.flatMap((counts, id) => (counts.reduce((a, b) => a + b, 0) === YACHT_DICE ? [id] : []));
  const reach = holds.map((counts) => {
    const rolled = YACHT_DICE - counts.reduce((a, b) => a + b, 0);
    const outcomes = distributions(rolled);
    const ids = new Int32Array(outcomes.length);
    const chance = new Float64Array(outcomes.length);
    outcomes.forEach((outcome, index) => {
      ids[index] = holdId.get(key(counts.map((count, face) => count + outcome[face])))!;
      chance[index] = FACTORIAL[rolled] / outcome.reduce((product, count) => product * FACTORIAL[count], 1) / 6 ** rolled;
    });
    return { ids, chance };
  });
  const keeps = holds.map((counts, id) => {
    const kept: number[] = [];
    if (full.includes(id)) {
      for (let size = 0; size < YACHT_DICE; size += 1) {
        for (const subset of distributions(size)) {
          if (subset.every((count, face) => count <= counts[face])) kept.push(holdId.get(key(subset))!);
        }
      }
    }
    return Int32Array.from(kept);
  });
  cached = { holds, full, holdId, reach, keeps };
  return cached;
}

function toDice(counts: Counts): YachtFace[] {
  return counts.flatMap((count, face) => Array<YachtFace>(count).fill((face + 1) as YachtFace));
}

export interface YachtPlan {
  /** Write the dice now rather than rolling again */
  readonly stop: boolean;
  /** The best box for the dice as they are */
  readonly box: YachtBox;
  /** Which dice (by position) to keep for the next roll */
  readonly held: readonly boolean[];
}

/**
 * Chooses between writing `dice` now and rolling again, for `rollsLeft` rolls (1 or 2). Every box is valued
 * by `yachtPlacementValue`; keeping a hold is worth the average value of its best continuation over every
 * possible reroll, so the plan is the exact expectimax of that value, not a rule of thumb.
 */
export function yachtPlan(card: YachtScorecard, dice: readonly YachtFace[], rollsLeft: number): YachtPlan {
  const { holds, holdId, reach, keeps } = tables();
  const stopValue = new Float64Array(holds.length).fill(Number.NaN);
  const stopAt = (id: number): number => {
    if (Number.isNaN(stopValue[id])) stopValue[id] = yachtBestPlacement(card, toDice(holds[id])).value;
    return stopValue[id];
  };
  const average = (hold: number, next: (id: number) => number): number => {
    const { ids, chance } = reach[hold];
    let total = 0;
    for (let index = 0; index < ids.length; index += 1) total += chance[index] * next(ids[index]);
    return total;
  };

  // Value of a hold with one roll left, then with two; later rolls average the earlier tables.
  const once = new Float64Array(holds.length).fill(Number.NaN);
  const onceFor = (hold: number): number => {
    if (Number.isNaN(once[hold])) once[hold] = average(hold, stopAt);
    return once[hold];
  };
  const stopOrRollOnce = new Float64Array(holds.length).fill(Number.NaN);
  const stopOrRollOnceAt = (id: number): number => {
    if (Number.isNaN(stopOrRollOnce[id])) {
      let best = stopAt(id);
      for (const hold of keeps[id]) best = Math.max(best, onceFor(hold));
      stopOrRollOnce[id] = best;
    }
    return stopOrRollOnce[id];
  };
  const holdValue = (hold: number): number => (rollsLeft >= 2 ? average(hold, stopOrRollOnceAt) : onceFor(hold));

  const counts = [0, 0, 0, 0, 0, 0];
  for (const die of dice) counts[die - 1] += 1;
  const current = holdId.get(key(counts))!;
  const placement = yachtBestPlacement(card, dice);
  let bestHold = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const hold of keeps[current]) {
    const value = holdValue(hold);
    if (value > bestValue) {
      bestValue = value;
      bestHold = hold;
    }
  }
  const remaining = [...holds[bestHold]];
  const held = dice.map((die) => {
    if (remaining[die - 1] === 0) return false;
    remaining[die - 1] -= 1;
    return true;
  });
  return { stop: placement.value >= bestValue, box: placement.box, held };
}

// Built at startup so no bot decision pays for it.
tables();
