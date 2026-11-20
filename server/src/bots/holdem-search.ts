import type { HoldemVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { decideHoldem } from './holdem-strategy';
import type { SearchContext } from './search/search-types';

const MIN_RUNS = 600;
const MAX_RUNS = 12_000;

/**
 * Worker-pool decision: the synchronous plan with many more equity samples (sampling continues while an estimate is
 * still near a threshold the decision hinges on) and exact enumeration of the turn and river against a single
 * opponent, so close calls in large pots are not decided by sampling noise. Sampling stops early once the budget runs
 * out.
 */
export function holdemSearch(visible: HoldemVisibleState, { random, budget }: SearchContext): BotAction | null {
  return decideHoldem(visible, random, { minRuns: MIN_RUNS, maxRuns: MAX_RUNS, exactTurn: true, expired: budget.expired });
}
