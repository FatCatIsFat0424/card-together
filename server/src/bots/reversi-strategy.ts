import type { ReversiVisibleState } from '@shared/types';
import { rvFlips, rvLegalMoves } from '@shared/rules/reversi';
import type { RvSide } from '@shared/rules/reversi';
import type { BotAction } from './bot-decisions';
import { QUICK_DEPTH, placeAction, searchBestCell, searchBoard, searchPlayer } from './reversi-search';

/** Noise added to a move's flip count, so equal-looking moves vary and a slightly worse one is sometimes played. */
const EASY_NOISE = 1.5;

/** The viewer's side when it is their turn in a running match, otherwise null. */
function sideToMove(visible: ReversiVisibleState): RvSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

/** Easy: greedy on discs flipped, with light randomness. Also the move a player gets after running out of time. */
export function easyReversiAction(visible: ReversiVisibleState, random: () => number): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  let best: { index: number; score: number } | null = null;
  for (const index of rvLegalMoves(visible.discs, side)) {
    const score = rvFlips(visible.discs, index, side).length + random() * EASY_NOISE;
    if (!best || score > best.score) best = { index, score };
  }
  return best ? placeAction(best.index) : null;
}

/**
 * Hard, synchronous: a shallow alpha-beta with the same evaluation as the worker search. In a search game this
 * only serves seats that are not on a bot's own turn, so it must stay cheap.
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
