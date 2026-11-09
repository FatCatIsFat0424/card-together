import { YACHT_DICE, YACHT_MAX_ROLLS, yachtFaceCounts, yachtLegalBoxes } from '@shared/rules/yacht';
import type { YachtBox, YachtFace, YachtScorecard } from '@shared/rules/yacht';
import { yachtBestPlacement } from '@shared/rules/yacht-value';
import type { YachtGameAction } from '@shared/games/yacht/actions';
import type { YachtTurn, YachtVisibleState } from '@shared/games/yacht/types';
import type { BotAction } from './bot-decisions';
import { yachtPlan } from './yacht-lookahead';

// Heuristic summary: a box is worth its score against what the box averages (see `yachtPlacementValue`), with
// credit for upper-bonus progress and for an extra Yacht.
// - Hard keeps the dice with the best exact expectation over the rolls left, then writes the best box.
// - Easy keeps the most common face, stops early on a clearly good roll, and writes the same best box.

/** An immediate placement this far above average ends an easy bot's turn. */
const EASY_STOP_VALUE = 12;

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

export function easyYachtAction(visible: YachtVisibleState, random: () => number = Math.random): BotAction | null {
  const open = owed(visible);
  if (!open) return null;
  const { turn, card } = open;
  if (turn.rolls === 0) return roll();
  const best = yachtBestPlacement(card, turn.dice);
  if (turn.rolls >= YACHT_MAX_ROLLS || best.value >= EASY_STOP_VALUE) return score(best.box);
  // Keep every die of the most common face, choosing between equal faces at random.
  const counts = yachtFaceCounts(turn.dice);
  const most = Math.max(...counts);
  const faces = ([1, 2, 3, 4, 5, 6] as YachtFace[]).filter((face) => counts[face] === most);
  const keep = faces[Math.floor(random() * faces.length)];
  const held = turn.dice.map((die) => die === keep);
  return held.length === YACHT_DICE && held.every(Boolean) ? score(best.box) : roll(held);
}

/** A deliberately simple legal move: roll once, then take the first box the dice may go into. */
export function yachtFirstLegalAction(visible: YachtVisibleState): BotAction | null {
  const open = owed(visible);
  if (!open) return null;
  return open.turn.rolls === 0 ? roll() : score(yachtLegalBoxes(open.card, open.turn.dice)[0]);
}

/** A seat that ran out of time rolls if it has not and writes its dice into the best box, as the easy bot would. */
export function yachtTimeoutAction(visible: YachtVisibleState): BotAction | null {
  return owed(visible) ? action({ type: 'auto' }) : null;
}
