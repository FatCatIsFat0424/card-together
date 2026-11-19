import type { JungleVisibleState } from '@shared/types';
import { jgLegalMoves } from '@shared/rules/jungle';
import type { JgSide } from '@shared/rules/jungle';
import type { BotAction } from './bot-decisions';
import { QUICK_DEPTH, moveAction, searchBestMove, searchCells } from './jungle-search';

/** The viewer's side when it is their turn in a running match, otherwise null. */
function sideToMove(visible: JungleVisibleState): JgSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

/**
 * Synchronous fallback: a shallow alpha-beta with the same evaluation as the worker search. It decides only
 * when no pool runs or a search fails, so it must stay cheap for the event loop.
 */
export function getJungleBotAction(visible: JungleVisibleState, random: () => number): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  const move = searchBestMove(searchCells(visible.cells), side, { maxDepth: QUICK_DEPTH, expired: () => false, random });
  return move === null ? null : moveAction(move);
}

/** The first legal move in board order: the last resort when the strategies keep failing. */
export function jungleFirstLegalAction(visible: JungleVisibleState): BotAction | null {
  const side = sideToMove(visible);
  const [first] = side === null ? [] : jgLegalMoves(visible.cells, side);
  return first === undefined ? null : moveAction(first);
}
