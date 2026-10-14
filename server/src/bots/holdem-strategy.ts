import type { HoldemVisibleState } from '@shared/types';
import { heLegalActions } from '@shared/rules/holdem';
import type { BotAction } from './bot-decisions';
import { buildContext } from './holdem-context';
import { readHistory } from './holdem-history';
import { postflopAction } from './holdem-postflop';
import { preflopAction } from './holdem-preflop';

export { holdemEquity } from './holdem-equity';

// Heuristic summary: preflop hands are ranked by a precomputed equity table and played by position, stack depth in
// big blinds and price. Raisers are assumed to hold the top slice of hands that matches how often they have raised
// or shoved earlier in the match (read from the public log, with a prior that dominates the first hands). After the
// flop the bot simulates its equity against ranges that narrow when opponents bet, mixes slowplays, check-raises and
// bluffs, and keeps bet sizes independent of hand strength. The match clock widens the bot's ranges in the last
// hands when it trails and tightens them when it leads. See the sibling holdem-* modules for each part.

export function getHoldemBotAction(visible: HoldemVisibleState, random: () => number): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  const context = buildContext(visible, legal);
  const history = readHistory(visible.log, visible.mySeat);
  const action = visible.street === 'preflop'
    ? preflopAction(visible, legal, context, history, random)
    : postflopAction(visible, legal, context, history, random);
  return { type: 'holdem-action', action };
}
