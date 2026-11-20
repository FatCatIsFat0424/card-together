import { performance } from 'node:perf_hooks';
import type { ChinesePokerVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { arrangeBySampling } from './chinesepoker-search';

/** Clock limit of the synchronous version: a few dozen samples, enough to beat the static ranking alone. */
const SYNC_BUDGET_MS = 40;

/**
 * Arranges once while the table is arranging. The pool search runs for a second or so; this version, used when the
 * pool is unavailable and at a missed shared deadline, samples opponents for a short time before it answers.
 */
export function getChinesePokerBotAction(visible: ChinesePokerVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'arranging' || visible.submitted[visible.mySeat] || visible.myArrangement) return null;
  const deadline = performance.now() + SYNC_BUDGET_MS;
  return {
    type: 'chinesepoker-arrange',
    arrangement: arrangeBySampling(visible.myHand, random, () => performance.now() >= deadline),
  };
}
