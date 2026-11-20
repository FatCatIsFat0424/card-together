// Solitaire solver for Yacht Dice: the optimal expected future score of every state, and the spread of the
// score under that optimal play. States are solved from the fullest card to the empty one, and each turn is an
// exact expectimax over the three rolls.
import { yachtDiceTables } from '../../server/src/bots/yacht-dice';
import { FULL_MASK, YACHT_STATE_COUNT, forEachPlacement, forEachState, stateIndex } from '../../server/src/bots/yacht-states';
import type { YachtFlag } from '../../server/src/bots/yacht-states';

export interface SolvedTable {
  /** Expected points still to be scored from each state, bonuses included */
  readonly mean: Float64Array;
  /** Expected square of those points */
  readonly second: Float64Array;
}

/** Solves every state; `onProgress` receives the number of filled boxes just finished. */
export function solveTable(onProgress?: (filled: number) => void): SolvedTable {
  const dice = yachtDiceTables();
  const { holds, full, reach, keeps } = dice;
  const mean = new Float64Array(YACHT_STATE_COUNT);
  const second = new Float64Array(YACHT_STATE_COUNT);
  const size = holds.length;
  const stopM = new Float64Array(size);
  const stopQ = new Float64Array(size);
  const onceM = new Float64Array(size);
  const onceQ = new Float64Array(size);
  const twiceM = new Float64Array(size);
  const twiceQ = new Float64Array(size);
  const afterM = new Float64Array(size);
  const afterQ = new Float64Array(size);
  const afterTwoM = new Float64Array(size);
  const afterTwoQ = new Float64Array(size);

  /** Averages `valueM`/`valueQ` over the rerolls of every hold smaller than five dice. */
  const average = (valueM: Float64Array, valueQ: Float64Array, intoM: Float64Array, intoQ: Float64Array): void => {
    for (let hold = 0; hold < size; hold += 1) {
      const { ids, chance } = reach[hold];
      if (ids.length === 1 && ids[0] === hold) continue;
      let totalM = 0;
      let totalQ = 0;
      for (let index = 0; index < ids.length; index += 1) {
        totalM += chance[index] * valueM[ids[index]];
        totalQ += chance[index] * valueQ[ids[index]];
      }
      intoM[hold] = totalM;
      intoQ[hold] = totalQ;
    }
  };

  /** Per full dice: stop now, or the best of rerolling a smaller hold; the choice follows the mean. */
  const decide = (rerollM: Float64Array, rerollQ: Float64Array, intoM: Float64Array, intoQ: Float64Array): void => {
    for (const id of full) {
      let bestM = stopM[id];
      let bestQ = stopQ[id];
      for (const keep of keeps[id]) {
        if (rerollM[keep] > bestM) {
          bestM = rerollM[keep];
          bestQ = rerollQ[keep];
        }
      }
      intoM[id] = bestM;
      intoQ[id] = bestQ;
    }
  };

  const bits = (mask: number): number => { let count = 0; for (let rest = mask; rest; rest &= rest - 1) count += 1; return count; };
  const byFilled: { mask: number; flag: YachtFlag; subtotal: number }[][] = Array.from({ length: 14 }, () => []);
  forEachState((mask, flag, subtotal) => { byFilled[bits(mask)].push({ mask, flag, subtotal }); });

  let bestM = 0;
  let bestQ = 0;
  for (let filled = 13; filled >= 0; filled -= 1) {
    for (const { mask, flag, subtotal } of byFilled[filled]) {
      const index = stateIndex(mask, flag, subtotal);
      if (mask === FULL_MASK) continue;
      const visit = (_box: number, points: number, nextMask: number, nextFlag: YachtFlag, nextSubtotal: number): void => {
        const next = stateIndex(nextMask, nextFlag, nextSubtotal);
        const value = points + mean[next];
        if (value > bestM) {
          bestM = value;
          bestQ = points * points + 2 * points * mean[next] + second[next];
        }
      };
      for (const id of full) {
        bestM = Number.NEGATIVE_INFINITY;
        forEachPlacement(dice, id, mask, flag, subtotal, visit);
        stopM[id] = bestM;
        stopQ[id] = bestQ;
      }
      average(stopM, stopQ, onceM, onceQ);
      decide(onceM, onceQ, afterM, afterQ);
      average(afterM, afterQ, twiceM, twiceQ);
      decide(twiceM, twiceQ, afterTwoM, afterTwoQ);
      const { ids, chance } = reach[0];
      let totalM = 0;
      let totalQ = 0;
      for (let at = 0; at < ids.length; at += 1) {
        totalM += chance[at] * afterTwoM[ids[at]];
        totalQ += chance[at] * afterTwoQ[ids[at]];
      }
      mean[index] = totalM;
      second[index] = totalQ;
    }
    onProgress?.(filled);
  }
  return { mean, second };
}
