import type { ReversiVisibleState } from '@shared/types';
import { rvLegalMoves } from '@shared/rules/reversi';
import type { BotAction } from './bot-decisions';
import { placeAction, quickCell, sideToMove } from './reversi-search';

/**
 * Synchronous fallback: the opening book, then a shallow search with the same evaluation as the worker and an
 * exact solve of the last few squares. It decides only when no pool runs or a search fails, so it stays cheap.
 */
export function getReversiBotAction(visible: ReversiVisibleState): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  const cell = quickCell(visible.discs, side);
  return cell === null ? null : placeAction(cell);
}

/** The first legal cell in board order: the last resort when the strategies keep failing. */
export function reversiFirstLegalAction(visible: ReversiVisibleState): BotAction | null {
  const side = sideToMove(visible);
  const [first] = side === null ? [] : rvLegalMoves(visible.discs, side);
  return first === undefined ? null : placeAction(first);
}
