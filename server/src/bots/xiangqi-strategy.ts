import type { XiangqiVisibleState } from '@shared/types';
import { xqLegalMoves } from '@shared/rules/xiangqi';
import type { BotAction } from './bot-decisions';
import { QUICK_BUDGET_MS, QUICK_DEPTH, moveAction, xiangqiBestMove, xiangqiEasyMove, xiangqiTurn } from './xiangqi-search';

/** Easy: two plies with noise (see `xiangqiEasyMove`). Also the move a player gets after running out of time. */
export function easyXiangqiAction(visible: XiangqiVisibleState, random: () => number): BotAction | null {
  const turn = xiangqiTurn(visible);
  const move = turn && xiangqiEasyMove(turn.board, turn.side, turn.plies, random);
  return move ? moveAction(move) : null;
}

/**
 * Hard, synchronous: a shallow, time-capped search with the worker's evaluation. In a search game this only
 * serves seats that are not on a bot's own turn, so it must stay cheap.
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
