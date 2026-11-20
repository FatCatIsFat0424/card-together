import type { LiarsDiceVisibleState } from '@shared/types';
import { ldiMinimalBid, ldiTotalDice } from '@shared/rules/liarsdice';
import type { BotAction } from './bot-decisions';
import { bidMove, callAction, liarsDiceSearch, moveAction } from './liarsdice-search';
import type { SearchContext } from './search/search-types';

// The synchronous bot is the same search with a handful of worlds and a few milliseconds; the worker pool runs the
// full budget (see liarsdice-search for the method).

const FALLBACK_SAMPLES = 48;
const FALLBACK_MS = 40;

function myTurn(visible: LiarsDiceVisibleState): boolean {
  return visible.phase === 'playing' && visible.currentTurnSeat === visible.mySeat;
}

export function getLiarsDiceBotAction(visible: LiarsDiceVisibleState, random: () => number): BotAction | null {
  const deadline = performance.now() + FALLBACK_MS;
  const context: SearchContext = {
    random,
    budget: {
      maxDepth: undefined,
      timeLeftMs: () => Math.max(0, deadline - performance.now()),
      expired: () => performance.now() >= deadline,
    },
  };
  return liarsDiceSearch(visible, context, { maxSamples: FALLBACK_SAMPLES });
}

/** A deliberately simple legal move: challenge any standing bid, otherwise open with the least bid. */
export function liarsDiceFirstLegalAction(visible: LiarsDiceVisibleState): BotAction | null {
  if (!myTurn(visible)) return null;
  if (visible.bid && visible.bid.seat !== visible.mySeat) return callAction();
  const opening = ldiMinimalBid(visible.bid, ldiTotalDice(visible.diceCounts));
  return opening ? moveAction(bidMove(opening.quantity, opening.face)) : null;
}
