import type { LiarsDeckVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { liarsDeckSearch } from './liarsdeck-search';
import type { SearchContext } from './search/search-types';

// The synchronous bot is the same search with a handful of worlds and a few milliseconds; the worker pool runs the
// full budget (see liarsdeck-search for the method).

const FALLBACK_SAMPLES = 48;
const FALLBACK_MS = 40;

export function getLiarsDeckBotAction(visible: LiarsDeckVisibleState, random: () => number): BotAction | null {
  const deadline = performance.now() + FALLBACK_MS;
  const context: SearchContext = {
    random,
    budget: {
      maxDepth: undefined,
      timeLeftMs: () => Math.max(0, deadline - performance.now()),
      expired: () => performance.now() >= deadline,
    },
  };
  return liarsDeckSearch(visible, context, { maxSamples: FALLBACK_SAMPLES });
}
