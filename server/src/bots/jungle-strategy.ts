import type { JungleVisibleState } from '@shared/types';
import { JG_COLS, jgDenCell, jgIsDen, jgLegalMoves, jgOpponent, jgRankOf } from '@shared/rules/jungle';
import type { JgMove, JgSide } from '@shared/rules/jungle';
import type { BotAction } from './bot-decisions';
import { QUICK_DEPTH, moveAction, searchBestMove, searchCells } from './jungle-search';

/** Noise added to a move's rating, so equal-looking moves vary and a slightly worse one is sometimes played. */
const EASY_NOISE = 3;

/** The viewer's side when it is their turn in a running match, otherwise null. */
function sideToMove(visible: JungleVisibleState): JgSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

const stepsToDen = (index: number, den: number): number =>
  Math.abs((index % JG_COLS) - (den % JG_COLS)) + Math.abs(Math.floor(index / JG_COLS) - Math.floor(den / JG_COLS));

/**
 * Easy: looks one move ahead only. It takes the den when it can, otherwise prefers the biggest capture, then
 * stepping toward the den, with enough randomness to miss threats and play loose moves. Also the move a player
 * gets after running out of time.
 */
export function easyJungleAction(visible: JungleVisibleState, random: () => number): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  const den = jgDenCell(jgOpponent(side));
  let best: { move: JgMove; score: number } | null = null;
  for (const move of jgLegalMoves(visible.cells, side)) {
    const target = visible.cells[move.to];
    const score = (jgIsDen(move.to, jgOpponent(side)) ? 100 : 0)
      + (target === 0 ? 0 : 2 * jgRankOf(target))
      + stepsToDen(move.from, den) - stepsToDen(move.to, den)
      + random() * EASY_NOISE;
    if (!best || score > best.score) best = { move, score };
  }
  return best ? moveAction(best.move) : null;
}

/**
 * Hard, synchronous: a shallow alpha-beta with the same evaluation as the worker search. In a search game this
 * only serves seats that are not on a bot's own turn, so it must stay cheap.
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
