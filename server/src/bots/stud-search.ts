import type { StudVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import type { SearchContext } from './search/search-types';
import { studDecision } from './stud-strategy';

// The worker pool's stud decision: the same evaluation as the synchronous bot with a time budget. Clear spots
// end after the minimum sample; close ones use the budget.

/** Time left in the budget at which sampling stops, so the answer returns before the pool's deadline. */
const RESERVE_MS = 80;
const MIN_WORLDS = 250;
const MAX_WORLDS = 20_000;

export function studSearch(visible: StudVisibleState, context: SearchContext): BotAction | null {
  const request = studDecision(visible, context.random, {
    minWorlds: MIN_WORLDS,
    maxWorlds: MAX_WORLDS,
    timeLeftMs: () => context.budget.timeLeftMs() - RESERVE_MS,
  });
  return request ? { type: 'game-action', request: { gameType: 'stud', action: request } } : null;
}
