// ─── Reversi bot: opening book, then bitboard search with a fitted pattern evaluation and an endgame solver ───
//
// Runs inside a bot worker (`GameBot.search`) with the whole budget, and as a cheap fixed-depth search for the
// synchronous fallback when no pool runs or a search fails. It reads only the seat's own view, which for
// Reversi is the whole public board.

import type { ReversiVisibleState } from '@shared/types';
import { rvNode } from '@shared/rules/reversi';
import type { RvDiscs, RvSide } from '@shared/rules/reversi';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';
import { fromDiscs } from './reversi-board';
import { bookMove } from './reversi-book';
import { searchPosition } from './reversi-engine';
import type { EngineLimits, EngineResult } from './reversi-engine';

/** Midgame plies of the synchronous fallback: a few milliseconds even in busy positions. */
export const QUICK_DEPTH = 4;
/** The synchronous fallback proves the result from this many empty squares. */
const QUICK_SOLVE_EMPTIES = 12;
/** The worker search tries to prove the result from this many empty squares. */
export const SOLVE_EMPTIES = 20;
/** Transposition table sizes (entries as a power of two): about 12 MB in a worker, 0.7 MB on the main thread. */
const WORKER_TABLE_BITS = 18;
const QUICK_TABLE_BITS = 14;

/** The viewer's side when it is their turn in a running match, otherwise null. */
export function sideToMove(visible: ReversiVisibleState): RvSide | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

export function placeAction(index: number): BotAction {
  return { type: 'game-action', request: { gameType: 'reversi', action: { type: 'place', to: rvNode(index) } } };
}

/** The engine's move for `side`, or null when it has no legal move. The book answers known openings. */
export function chooseCell(discs: RvDiscs, side: RvSide, limits: EngineLimits): (EngineResult & { book: boolean }) | null {
  const board = fromDiscs(discs, side);
  const fromBook = bookMove(board);
  if (fromBook >= 0) return { move: fromBook, score: 0, depth: 0, solved: false, nodes: 0, book: true };
  const result = searchPosition(board, limits);
  return result.move < 0 ? null : { ...result, book: false };
}

/** Synchronous fallback: book, fixed shallow search, and a small endgame solve; no clock involved. */
export function quickCell(discs: RvDiscs, side: RvSide): number | null {
  return chooseCell(discs, side, {
    maxDepth: QUICK_DEPTH, expired: () => false, clock: null, solveEmpties: QUICK_SOLVE_EMPTIES, tableBits: QUICK_TABLE_BITS,
  })?.move ?? null;
}

/** Search strategy for the bot worker pool: iterative deepening for the whole budget, then a solve near the end. */
export function reversiSearch(visible: ReversiVisibleState, context: SearchContext): BotAction | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  const { budget } = context;
  const budgetMs = budget.timeLeftMs();
  const result = chooseCell(visible.discs, side, {
    maxDepth: budget.maxDepth ?? 60,
    expired: budget.expired,
    clock: { budgetMs, elapsedMs: () => budgetMs - budget.timeLeftMs() },
    solveEmpties: SOLVE_EMPTIES,
    tableBits: WORKER_TABLE_BITS,
  });
  return result === null ? null : placeAction(result.move);
}
