// ─── Yacht Dice box valuation shared by the bots and the timeout action ───

import {
  YACHT_EXTRA_BONUS, YACHT_UPPER_BONUS, YACHT_UPPER_BONUS_TARGET, YACHT_UPPER_BOXES, isUpperBox,
  isYachtJoker, upperFace, yachtLegalBoxes, yachtScoreIn,
} from './yacht';
import type { YachtBox, YachtFace, YachtScorecard } from './yacht';

/** Average score each box ends with under good solitaire play; a placement is worth its gain over this. */
export const YACHT_PAR: Readonly<Record<YachtBox, number>> = {
  ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2,
  threeKind: 21.7, fourKind: 13.1, fullHouse: 22.6, smallStraight: 29.5, largeStraight: 32.7, yacht: 16.9, chance: 22,
};

/** Value of one point above or below three of a face, towards the 35-point bonus. */
const BONUS_POINT_VALUE = 0.55;

/** Whether the upper section can still reach the bonus once `box` is filled with `score`. */
function bonusReachable(card: YachtScorecard, box: YachtBox, score: number): boolean {
  let best = score;
  for (const other of YACHT_UPPER_BOXES) {
    if (other === box) continue;
    best += card.boxes[other] ?? upperFace(other) * 5;
  }
  return best >= YACHT_UPPER_BONUS_TARGET;
}

/**
 * How much better than average writing `dice` into `box` is: the score against the box's par, a bonus for a
 * joker's extra Yacht, and progress towards the upper bonus (three of each face is exactly 63).
 */
export function yachtPlacementValue(card: YachtScorecard, box: YachtBox, dice: readonly YachtFace[]): number {
  const score = yachtScoreIn(card, box, dice);
  let value = score - YACHT_PAR[box] + (isYachtJoker(card, dice) ? YACHT_EXTRA_BONUS : 0);
  if (isUpperBox(box) && bonusReachable(card, box, score)) {
    value += (score - 3 * upperFace(box)) * BONUS_POINT_VALUE;
    // Securing the bonus outright is worth the points it adds.
    const upperSoFar = YACHT_UPPER_BOXES.reduce((sum, other) => sum + (card.boxes[other] ?? 0), 0);
    if (upperSoFar < YACHT_UPPER_BONUS_TARGET && upperSoFar + score >= YACHT_UPPER_BONUS_TARGET) value += YACHT_UPPER_BONUS * 0.5;
  }
  return value;
}

/** The best legal box for the dice and its value. */
export function yachtBestPlacement(card: YachtScorecard, dice: readonly YachtFace[]): { box: YachtBox; value: number } {
  let best: { box: YachtBox; value: number } | null = null;
  for (const box of yachtLegalBoxes(card, dice)) {
    const value = yachtPlacementValue(card, box, dice);
    if (!best || value > best.value) best = { box, value };
  }
  if (!best) throw new Error('A full scorecard has no box left.');
  return best;
}

/** The box the timeout action and the easy bot write the dice into. */
export function yachtBestBox(card: YachtScorecard, dice: readonly YachtFace[]): YachtBox {
  return yachtBestPlacement(card, dice).box;
}
