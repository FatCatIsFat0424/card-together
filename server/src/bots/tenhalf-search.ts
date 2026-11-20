import type { TenHalfVisibleState } from '@shared/types';
import type { BotAction } from './bot-decisions';
import { getTenHalfBotAction, tenHalfBetAction } from './tenhalf-strategy';
import { SEARCH_RACE } from './chip-race';
import type { SearchContext } from './search/search-types';

// Worker-side Ten and a Half bot: the stake comes from the race plan replayed against simulated rivals (see
// chip-race); draws are the synchronous bot's.

export function tenHalfSearch(visible: TenHalfVisibleState, context: SearchContext): BotAction | null {
  if (visible.phase === 'betting') return tenHalfBetAction(visible, context.random, SEARCH_RACE);
  return getTenHalfBotAction(visible, context.random);
}
