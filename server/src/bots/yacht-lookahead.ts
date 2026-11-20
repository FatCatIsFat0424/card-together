// ─── Yacht Dice lookahead: the best dice to keep, valued by exact expectation over the rolls left ───

import { YACHT_BOXES, yachtTotals } from '@shared/rules/yacht';
import type { YachtBox, YachtFace, YachtScorecard } from '@shared/rules/yacht';
import { yachtDiceTables } from './yacht-dice';
import { cardState, forEachPlacement, stateIndex } from './yacht-states';
import { yachtTable } from './yacht-table';
import { yachtWinChance } from './yacht-win';
import type { YachtRival } from './yacht-win';

export type { YachtRival } from './yacht-win';

const TIE_BREAK = 1e-6;

export interface YachtPlan {
  /** Write the dice now rather than rolling again */
  readonly stop: boolean;
  /** The best box for the dice as they are */
  readonly box: YachtBox;
  /** Which dice (by position) to keep for the next roll */
  readonly held: readonly boolean[];
}

/**
 * Chooses between writing `dice` now and rolling again, for `rollsLeft` rolls (0 to 2). Writing a box is worth
 * its points plus the solved value of the card it leaves (`yacht-table.ts`), and keeping a hold is worth the
 * average of its best continuation over every possible reroll, so each turn is played exactly. Alone the value
 * is the expected final score; against rivals it is the chance of finishing ahead of them (`yacht-win.ts`).
 */
export function yachtPlan(
  card: YachtScorecard,
  dice: readonly YachtFace[],
  rollsLeft: number,
  rivals: readonly YachtRival[] = [],
): YachtPlan {
  const tables = yachtDiceTables();
  const { holds, holdId, reach, keeps } = tables;
  const { mean, spread } = yachtTable();
  const { mask, flag, subtotal } = cardState(card);
  const winChance = rivals.length > 0 ? yachtWinChance(rivals) : null;
  const banked = yachtTotals(card).total;

  const stopValue = new Float64Array(holds.length).fill(Number.NaN);
  const stopBox = new Int32Array(holds.length).fill(-1);
  const stopAt = (id: number): number => {
    if (!Number.isNaN(stopValue[id])) return stopValue[id];
    let best = Number.NEGATIVE_INFINITY;
    forEachPlacement(tables, id, mask, flag, subtotal, (box, points, nextMask, nextFlag, nextSubtotal) => {
      const next = stateIndex(nextMask, nextFlag, nextSubtotal);
      const expected = points + mean[next];
      // The expected score breaks ties between lines whose win chance is the same, such as once the match is decided.
      const value = winChance ? winChance(banked + expected, spread[next]) + expected * TIE_BREAK : expected;
      if (value > best) {
        best = value;
        stopBox[id] = box;
      }
    });
    stopValue[id] = best;
    return best;
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
  const current = holdId[counts.reduce((total, count) => total * 6 + count, 0)];
  const stopNow = stopAt(current);
  const boxOf = (): YachtBox => {
    if (stopBox[current] < 0) throw new Error('A full scorecard has no box left.');
    return YACHT_BOXES[stopBox[current]];
  };
  if (rollsLeft <= 0) return { stop: true, box: boxOf(), held: dice.map(() => true) };
  let bestHold = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const hold of keeps[current]) {
    const value = holdValue(hold);
    if (value > bestValue) {
      bestValue = value;
      bestHold = hold;
    }
  }
  const remaining = bestHold >= 0 ? [...holds[bestHold]] : [];
  const held = dice.map((die) => {
    if (!remaining[die - 1]) return false;
    remaining[die - 1] -= 1;
    return true;
  });
  return { stop: stopNow >= bestValue, box: boxOf(), held };
}

// Loaded at startup so no bot decision pays for it, and a missing table fails fast.
yachtDiceTables();
yachtTable();
