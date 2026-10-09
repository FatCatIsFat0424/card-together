import type { ChinesePokerVisibleState } from '@shared/types';
import { cpRankArrangements } from '@shared/rules/chinesepoker-arrange';
import type { BotAction } from './bot-decisions';
import { selectNearBest } from './selection';

const CANDIDATES = 6;
/** Estimated points per opponent; close arrangements usually differ only in kicker placement. */
const MARGIN = 0.05;

/** Arranges once while the table is arranging; every candidate is a non-foul arrangement. */
export function getChinesePokerBotAction(visible: ChinesePokerVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'arranging' || visible.submitted[visible.mySeat] || visible.myArrangement) return null;
  const options = cpRankArrangements(visible.myHand, CANDIDATES)
    .map(({ arrangement, score }) => ({ value: arrangement, score }));
  const arrangement = selectNearBest(options, random, MARGIN);
  return arrangement ? { type: 'chinesepoker-arrange', arrangement } : null;
}
