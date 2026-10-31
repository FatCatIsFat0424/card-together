import type { ChessVisibleState } from '@shared/types';
import { chessLegalMoves } from '@shared/rules/chess';
import type { BotAction } from './bot-decisions';
import { QUICK_BUDGET_MS, QUICK_DEPTH, chessBestMove, chessEasyMove, chessTurn, moveAction } from './chess-search';

/** Easy: two plies with noise (see `chessEasyMove`). Also the move a player gets after running out of time. */
export function easyChessAction(visible: ChessVisibleState, random: () => number): BotAction | null {
  const turn = chessTurn(visible);
  const move = turn && chessEasyMove(turn.position, turn.side, turn.history, random);
  return move ? moveAction(move) : null;
}

/**
 * Hard, synchronous: a shallow, time-capped search with the worker's evaluation. In a search game this only
 * serves seats that are not on a bot's own turn, so it must stay cheap.
 */
export function getChessBotAction(visible: ChessVisibleState, random: () => number): BotAction | null {
  const turn = chessTurn(visible);
  if (!turn) return null;
  const deadline = performance.now() + QUICK_BUDGET_MS;
  const move = chessBestMove(turn.position, turn.side, turn.history, {
    maxDepth: QUICK_DEPTH, budget: { expired: () => performance.now() >= deadline }, random,
  });
  return move ? moveAction(move) : null;
}

/** The first legal move in board order, queening a promotion: the last resort when the strategies keep failing. */
export function chessFirstLegalAction(visible: ChessVisibleState): BotAction | null {
  const turn = chessTurn(visible);
  const [first] = turn ? chessLegalMoves(turn.position) : [];
  return first ? moveAction(first) : null;
}
