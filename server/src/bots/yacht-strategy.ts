import { YACHT_MAX_ROLLS, yachtLegalBoxes } from '@shared/rules/yacht';
import type { YachtBox, YachtScorecard } from '@shared/rules/yacht';
import { yachtBestPlacement } from '@shared/rules/yacht-value';
import type { YachtGameAction } from '@shared/games/yacht/actions';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import type { BotAction } from './bot-decisions';
import { yachtPlan } from './yacht-lookahead';

// Heuristic summary: a box is worth its score against what the box averages (see `yachtPlacementValue`), with
// credit for upper-bonus progress and for an extra Yacht. The bot keeps the dice with the best exact expectation
// over the rolls left, then writes the best box.

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

export function getYachtBotAction(visible: YachtVisibleState): BotAction | null {
  const open = owed(visible);
  if (!open) return null;
  const { turn, card } = open;
  if (turn.rolls === 0) return roll();
  if (turn.rolls >= YACHT_MAX_ROLLS) return score(yachtBestPlacement(card, turn.dice).box);
  const plan = yachtPlan(card, turn.dice, YACHT_MAX_ROLLS - turn.rolls);
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
