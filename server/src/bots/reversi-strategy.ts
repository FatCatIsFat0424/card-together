import type { ReversiVisibleState } from '@shared/types';
import { rvLegalMoves } from '@shared/rules/reversi';
import type { RvSide } from '@shared/rules/reversi';
import type { BotAction } from './bot-decisions';
import { QUICK_DEPTH, placeAction, searchBestCell, searchBoard, searchPlayer } from './reversi-search';

/** The viewer's side when it is their turn in a running match, otherwise null. */
function sideToMove(visible: ReversiVisibleState): RvSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

/**
 * Synchronous fallback: a shallow alpha-beta with the same evaluation as the worker search. It decides only
 * when no pool runs or a search fails, so it must stay cheap for the event loop.
 */
export function getReversiBotAction(visible: ReversiVisibleState, random: () => number): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  const cell = searchBestCell(searchBoard(visible.discs), searchPlayer(side), {
    maxDepth: QUICK_DEPTH, expired: () => false, random,
  });
  return cell === null ? null : placeAction(cell);
}

/** The first legal cell in board order: the last resort when the strategies keep failing. */
export function reversiFirstLegalAction(visible: ReversiVisibleState): BotAction | null {
  const side = sideToMove(visible);
  const [first] = side === null ? [] : rvLegalMoves(visible.discs, side);
  return first === undefined ? null : placeAction(first);
}
