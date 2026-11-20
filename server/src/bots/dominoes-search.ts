import type { DominoesVisibleState } from '@shared/games/dominoes/types';
import type { BotAction } from './bot-decisions';
import { decideDominoes } from './dominoes-strategy';
import type { SearchContext } from './search/search-types';

/** Worker entry: the bot's decision with the worker's budget and many more deals (see `decideDominoes`). */
export function dominoesSearch(visible: DominoesVisibleState, context: SearchContext): BotAction | null {
  return decideDominoes(visible, context.random, context);
}
