import type { JungleVisibleState } from '@shared/types';
import { jgLegalMoves } from '@shared/rules/jungle';
import type { BotAction } from './bot-decisions';
import { QUICK_DEPTH, QUICK_TABLE_BITS, decideMove, moveAction, sideToMove } from './jungle-search';

/**
 * Synchronous fallback: the worker's search at a shallow depth with a small table. It decides only when no pool
 * runs or a search fails, so it must stay cheap for the event loop.
 */
export function getJungleBotAction(visible: JungleVisibleState, random: () => number): BotAction | null {
  const move = decideMove(visible, { maxDepth: QUICK_DEPTH, expired: () => false, random, tableBits: QUICK_TABLE_BITS });
  return move === null ? null : moveAction(move);
}

/** The first legal move in board order: the last resort when the strategies keep failing. */
export function jungleFirstLegalAction(visible: JungleVisibleState): BotAction | null {
  const side = sideToMove(visible);
  const [first] = side === null ? [] : jgLegalMoves(visible.cells, side);
  return first === undefined ? null : moveAction(first);
}
