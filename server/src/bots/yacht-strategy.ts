import { YACHT_MAX_ROLLS, yachtLegalBoxes, yachtTotals } from '@shared/rules/yacht';
import type { YachtBox, YachtScorecard } from '@shared/rules/yacht';
import type { YachtGameAction } from '@shared/games/yacht/actions';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import type { BotAction } from './bot-decisions';
import { yachtPlan } from './yacht-lookahead';
import type { YachtRival } from './yacht-lookahead';
import { cardState } from './yacht-states';
import { yachtFutureMean, yachtFutureSpread } from './yacht-table';

// The bot plays each turn exactly (see `yachtPlan`): every box is valued by its points plus the solved value of
// the card it leaves, and the rivals' public cards turn that value into a chance of winning.

function action(request: YachtGameAction): BotAction {
  return { type: 'game-action', request: { gameType: 'yacht', action: request } };
}

const roll = (held?: readonly boolean[]): BotAction => action(held ? { type: 'roll', held } : { type: 'roll' });
const score = (box: YachtBox): BotAction => action({ type: 'score', box });

/** The seat's open turn and card when it must act now. */
function owed(visible: YachtVisibleState): { turn: YachtTurn; card: YachtScorecard } | null {
  if (visible.phase !== 'playing') return null;
  const turn = visible.turns[visible.mySeat];
  const card = visible.cards[visible.mySeat];
  if (!turn || !card || turn.done) return null;
  if (visible.options.mode === 'turns' && visible.currentTurnSeat !== visible.mySeat) return null;
  return { turn, card };
}

/** Where each rival's final total is expected to land, read from the public cards. */
function rivalsOf(visible: YachtVisibleState): YachtRival[] {
  const rivals: YachtRival[] = [];
  for (const seat of visible.seats) {
    const card = visible.cards[seat];
    if (seat === visible.mySeat || !card) continue;
    const { mask, flag, subtotal } = cardState(card);
    rivals.push({
      mean: yachtTotals(card).total + yachtFutureMean(mask, flag, subtotal),
      spread: yachtFutureSpread(mask, flag, subtotal),
    });
  }
  return rivals;
}

/**
 * The rivals to play against, only in a match of two. Against one rival, trading some expected score for the
 * right amount of risk wins more often; against several, the same trade measured worse than plain expected-score
 * play, so the bot then maximizes its own expected total.
 */
function rivalsFor(visible: YachtVisibleState): YachtRival[] {
  return visible.seats.length === 2 ? rivalsOf(visible) : [];
}

export function getYachtBotAction(visible: YachtVisibleState): BotAction | null {
  const open = owed(visible);
  if (!open) return null;
  const { turn, card } = open;
  if (turn.rolls === 0) return roll();
  if (turn.rolls >= YACHT_MAX_ROLLS) return score(yachtPlan(card, turn.dice, 0, rivalsFor(visible)).box);
  const plan = yachtPlan(card, turn.dice, YACHT_MAX_ROLLS - turn.rolls, rivalsFor(visible));
  return plan.stop || plan.held.every(Boolean) ? score(plan.box) : roll(plan.held);
}

/** A deliberately simple legal move: roll once, then take the first box the dice may go into. */
export function yachtFirstLegalAction(visible: YachtVisibleState): BotAction | null {
  const open = owed(visible);
  if (!open) return null;
  return open.turn.rolls === 0 ? roll() : score(yachtLegalBoxes(open.card, open.turn.dice)[0]);
}

/** A seat that ran out of time rolls if it has not and writes its dice into the best box. */
export function yachtTimeoutAction(visible: YachtVisibleState): BotAction | null {
  return owed(visible) ? action({ type: 'auto' }) : null;
}
