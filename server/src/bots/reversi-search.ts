// ─── Reversi search: iterative-deepening alpha-beta with positional weights and mobility ───
//
// Runs inside a bot worker (`GameBot.search`) and, at a shallow depth, as the cheap synchronous move that
// serves player timeouts. It reads only the seat's own view, which for Reversi is the whole public board.

import type { ReversiVisibleState } from '@shared/types';
import { RV_CELLS, RV_SIZE, rvNode } from '@shared/rules/reversi';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

/** Cell contents while searching: 0 empty, otherwise the player's number. */
type Board = Int8Array;
type Player = 1 | 2;

const DARK: Player = 1;
const LIGHT: Player = 2;

const opponent = (player: Player): Player => (player === DARK ? LIGHT : DARK);

/** Classic square values: corners are worth taking, squares beside an open corner are worth avoiding. */
const WEIGHTS: readonly number[] = (() => {
  const quarter = [
    [120, -20, 20, 5],
    [-20, -40, -5, -5],
    [20, -5, 15, 3],
    [5, -5, 3, 3],
  ];
  return Array.from({ length: RV_CELLS }, (_, index) => {
    const row = Math.floor(index / RV_SIZE);
    const col = index % RV_SIZE;
    return quarter[Math.min(row, RV_SIZE - 1 - row)][Math.min(col, RV_SIZE - 1 - col)];
  });
})();

/** For the three squares around each corner, the corner they depend on; -1 elsewhere. */
const CORNER_OF: readonly number[] = (() => {
  const owner = new Array<number>(RV_CELLS).fill(-1);
  const last = RV_SIZE - 1;
  for (const [col, row] of [[0, 0], [last, 0], [0, last], [last, last]]) {
    const dc = col === 0 ? 1 : -1;
    const dr = row === 0 ? 1 : -1;
    const corner = row * RV_SIZE + col;
    for (const [c, r] of [[col + dc, row], [col, row + dr], [col + dc, row + dr]]) owner[r * RV_SIZE + c] = corner;
  }
  return owner;
})();

/** Cells in the order a search tries them: best squares first, which tightens alpha-beta cut-offs. */
const ORDER: readonly number[] = Array.from({ length: RV_CELLS }, (_, index) => index)
  .sort((a, b) => WEIGHTS[b] - WEIGHTS[a] || a - b);

/** For every cell, the cells along each of the eight directions until the edge. */
const RAYS: readonly (readonly (readonly number[])[])[] = Array.from({ length: RV_CELLS }, (_, index) => {
  const col = index % RV_SIZE;
  const row = Math.floor(index / RV_SIZE);
  const rays: number[][] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const ray: number[] = [];
      for (let r = row + dr, c = col + dc; r >= 0 && r < RV_SIZE && c >= 0 && c < RV_SIZE; r += dr, c += dc) {
        ray.push(r * RV_SIZE + c);
      }
      if (ray.length > 1) rays.push(ray);
    }
  }
  return rays;
});

/** Whether `player` flips anything by placing at `index` (the cell must be empty). */
function flipsAny(board: Board, index: number, player: Player): boolean {
  const other = opponent(player);
  for (const ray of RAYS[index]) {
    if (board[ray[0]] !== other) continue;
    for (let step = 1; step < ray.length; step++) {
      const cell = board[ray[step]];
      if (cell === player) return true;
      if (cell !== other) break;
    }
  }
  return false;
}

/** The board after `player` places at `index`; the caller has checked the move is legal. */
function place(board: Board, index: number, player: Player): Board {
  const other = opponent(player);
  const next = board.slice();
  next[index] = player;
  for (const ray of RAYS[index]) {
    if (board[ray[0]] !== other) continue;
    let end = -1;
    for (let step = 1; step < ray.length; step++) {
      const cell = board[ray[step]];
      if (cell === player) {
        end = step;
        break;
      }
      if (cell !== other) break;
    }
    for (let step = 0; step < end; step++) next[ray[step]] = player;
  }
  return next;
}

function mobility(board: Board, player: Player): number {
  let count = 0;
  for (let index = 0; index < RV_CELLS; index++) {
    if (board[index] === 0 && flipsAny(board, index, player)) count++;
  }
  return count;
}

/** Final disc difference scaled above any heuristic value, so a won ending always beats a good-looking one. */
function terminal(board: Board, player: Player): number {
  let diff = 0;
  for (const cell of board) diff += cell === player ? 1 : cell === 0 ? 0 : -1;
  return diff === 0 ? 0 : (diff > 0 ? 100_000 : -100_000) + diff;
}

/**
 * Score for `player` to move: positional weights (ignoring squares whose corner is taken), mobility, and, as
 * the board fills, plain disc difference.
 */
function evaluate(board: Board, player: Player): number {
  const other = opponent(player);
  let positional = 0;
  let discs = 0;
  let empties = 0;
  for (let index = 0; index < RV_CELLS; index++) {
    const cell = board[index];
    if (cell === 0) {
      empties++;
      continue;
    }
    const sign = cell === player ? 1 : -1;
    discs += sign;
    const corner = CORNER_OF[index];
    if (corner < 0 || board[corner] === 0) positional += sign * WEIGHTS[index];
  }
  const mine = mobility(board, player);
  const theirs = mobility(board, other);
  if (mine === 0 && theirs === 0) return terminal(board, player);
  const mobilityScore = mine + theirs === 0 ? 0 : (100 * (mine - theirs)) / (mine + theirs + 2);
  const discWeight = empties <= 14 ? 14 - empties + 1 : 0;
  return positional + 2 * mobilityScore + discWeight * discs;
}

class Stop extends Error {}

interface Limits {
  readonly expired: () => boolean;
}

function searchNode(
  board: Board, player: Player, depth: number, alpha: number, beta: number, passed: boolean,
  limits: Limits, counter: { nodes: number },
): number {
  if ((++counter.nodes & 255) === 0 && limits.expired()) throw new Stop();
  let best = -Infinity;
  let moved = false;
  for (const index of ORDER) {
    if (board[index] !== 0 || !flipsAny(board, index, player)) continue;
    moved = true;
    if (depth <= 1) {
      // The last ply scores the resulting position directly instead of recursing into it.
      const score = -evaluate(place(board, index, player), opponent(player));
      if (score > best) best = score;
    } else {
      const score = -searchNode(place(board, index, player), opponent(player), depth - 1, -beta, -alpha, false, limits, counter);
      if (score > best) best = score;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (moved) return best;
  // A skipped turn costs no depth; two in a row end the game.
  if (passed) return terminal(board, player);
  return -searchNode(board, opponent(player), depth, -beta, -alpha, true, limits, counter);
}

export interface ReversiSearchOptions {
  /** Deepest ply to search; the search also stops after solving the position to the end. */
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
}

/** Cell indices of the legal moves for `player`, best squares first. */
function legalCells(board: Board, player: Player): number[] {
  return ORDER.filter((index) => board[index] === 0 && flipsAny(board, index, player));
}

/**
 * Iterative deepening from the shallowest ply: the best move of the last fully searched depth wins, and equal
 * moves are chosen between at random. Returns null when `player` has no legal move.
 */
export function searchBestCell(board: Board, player: Player, options: ReversiSearchOptions): number | null {
  const moves = legalCells(board, player);
  if (moves.length === 0) return null;
  let best = moves[0];
  if (moves.length === 1) return best;
  const empties = board.reduce((count, cell) => count + (cell === 0 ? 1 : 0), 0);
  const limit = Math.min(options.maxDepth, empties);
  let ordered = moves;
  for (let depth = 1; depth <= limit; depth++) {
    const counter = { nodes: 0 };
    let alpha = -Infinity;
    let scores: { index: number; score: number }[] = [];
    try {
      for (const index of ordered) {
        const next = place(board, index, player);
        // Equal scores are all kept, so the window may only cut moves that are strictly worse.
        const score = -searchNode(next, opponent(player), depth, -Infinity, -alpha + 1, false, options, counter);
        scores.push({ index, score });
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (error instanceof Stop) break;
      throw error;
    }
    scores = scores.sort((a, b) => b.score - a.score);
    const top = scores.filter((entry) => entry.score === scores[0].score);
    best = top[Math.floor(options.random() * top.length)].index;
    ordered = scores.map((entry) => entry.index);
    if (options.expired()) break;
  }
  return best;
}

/** The searcher's board for a view's discs: dark is player 1, light player 2. */
export function searchBoard(discs: ReversiVisibleState['discs']): Board {
  return Int8Array.from(discs, (cell) => (cell === null ? 0 : cell === 0 ? DARK : LIGHT));
}

export const searchPlayer = (side: 0 | 1): Player => (side === 0 ? DARK : LIGHT);

export function placeAction(index: number): BotAction {
  return { type: 'game-action', request: { gameType: 'reversi', action: { type: 'place', to: rvNode(index) } } };
}

/** Plies the synchronous move looks ahead: enough to avoid giving away corners, cheap enough for a timeout. */
export const QUICK_DEPTH = 3;

/** Search strategy for the bot worker pool. */
export function reversiSearch(visible: ReversiVisibleState, context: SearchContext): BotAction | null {
  const side = visible.seats.indexOf(visible.mySeat);
  if (side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const cell = searchBestCell(searchBoard(visible.discs), searchPlayer(side === 0 ? 0 : 1), {
    maxDepth: context.budget.maxDepth ?? 10, expired: context.budget.expired, random: context.random,
  });
  return cell === null ? null : placeAction(cell);
}
