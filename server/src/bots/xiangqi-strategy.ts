import type { XiangqiVisibleState } from '@shared/types';
import { xqLegalMoves } from '@shared/rules/xiangqi';
import type { BotAction } from './bot-decisions';
import { QUICK_BUDGET_MS, QUICK_DEPTH, moveAction, xiangqiBestMove, xiangqiTurn } from './xiangqi-search';

/**
 * Synchronous fallback: a shallow, time-capped search with the worker's evaluation. It decides only when no
 * pool runs or a search fails, so it must stay cheap for the event loop.
 */
export function getXiangqiBotAction(visible: XiangqiVisibleState, random: () => number): BotAction | null {
  const turn = xiangqiTurn(visible);
  if (!turn) return null;
  const deadline = performance.now() + QUICK_BUDGET_MS;
  const move = xiangqiBestMove(turn.board, turn.side, turn.plies, {
    maxDepth: QUICK_DEPTH, expired: () => performance.now() >= deadline, random,
  });
  return move ? moveAction(move) : null;
}

/** The first legal move in board order: the last resort when the strategies keep failing. */
export function xiangqiFirstLegalAction(visible: XiangqiVisibleState): BotAction | null {
  const turn = xiangqiTurn(visible);
  const [first] = turn ? xqLegalMoves(turn.board, turn.side) : [];
  return first ? moveAction(first) : null;
}
