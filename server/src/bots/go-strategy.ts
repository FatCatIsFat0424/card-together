import type { GoVisibleState } from '@shared/types';
import { goLegalPoints } from '@shared/rules/go';
import type { BotAction } from './bot-decisions';
import {
  GO_QUICK_ITERATIONS, goBestMove, goConfirmAction, goMarkingAction, goMarkingTurn, goMoveAction, goPassAction,
  goPlaceAction, goPlayingTurn, goSeatView,
} from './go-search';

/**
 * Synchronous fallback: the same search as the worker with a small iteration cap. It decides only when no
 * pool runs, a search fails, or a marking deadline passes, so it must stay cheap for the event loop.
 */
export function getGoBotAction(visible: GoVisibleState, random: () => number): BotAction | null {
  if (goMarkingTurn(visible)) return goMarkingAction(visible, random);
  if (!goPlayingTurn(visible)) return null;
  const view = goSeatView(visible);
  return view
    ? goMoveAction(visible, goBestMove(view.position, view.history, { random, maxIterations: GO_QUICK_ITERATIONS }))
    : null;
}

/** The legal point nearest the centre, else a pass: the last resort when the strategies keep failing. */
export function goFirstLegalAction(visible: GoVisibleState): BotAction | null {
  if (goMarkingTurn(visible)) return goConfirmAction(visible);
  if (!goPlayingTurn(visible)) return null;
  const view = goSeatView(visible);
  if (!view) return null;
  const { size } = visible.options;
  const middle = (size - 1) / 2;
  const distance = (point: number): number => Math.max(Math.abs((point % size) - middle), Math.abs(Math.floor(point / size) - middle));
  const [first] = goLegalPoints(view.position, view.history).sort((a, b) => distance(a) - distance(b) || a - b);
  return first === undefined ? goPassAction() : goPlaceAction(size, first);
}
