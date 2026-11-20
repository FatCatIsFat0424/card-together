import type { HoldemVisibleState } from '@shared/types';
import { heLegalActions } from '@shared/rules/holdem';
import type { BotAction } from './bot-decisions';
import { buildContext } from './holdem-context';
import { FAST_EFFORT } from './holdem-equity';
import type { Effort } from './holdem-equity';
import { postflopAction } from './holdem-postflop';
import { preflopAction } from './holdem-preflop';

export { holdemEquity } from './holdem-equity';

// Summary: short stacks play offline push/fold equilibrium charts; deeper stacks open by position and answer raises
// by chip expectation against generic ranges for the action taken. After the flop each opponent's range narrows with
// every action and bet size it chose this hand (the same model for every player; nothing is learned about a
// particular opponent), and bets, raises, calls and bluffs are chosen by chip expectation, which ties bet size to hand
// strength. The match clock widens ranges in the last hands when trailing and tightens them when leading. The worker
// pool runs the same plan with more equity samples and exact turn and river enumeration (holdem-search).

/** The decision for `visible` with the given estimation effort. */
export function decideHoldem(visible: HoldemVisibleState, random: () => number, effort: Effort): BotAction | null {
  if (visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const legal = heLegalActions(visible, visible.mySeat);
  if (!legal) return null;
  const context = buildContext(visible, legal, random, effort);
  const action = visible.street === 'preflop' ? preflopAction(legal, context) : postflopAction(visible, legal, context);
  return { type: 'holdem-action', action };
}

/** The synchronous fallback: the same plan with a small sampling budget. */
export function getHoldemBotAction(visible: HoldemVisibleState, random: () => number): BotAction | null {
  return decideHoldem(visible, random, FAST_EFFORT);
}
