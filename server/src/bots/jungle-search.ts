// ─── Jungle search: principal-variation alpha-beta over a typed-array board with a transposition table ───
//
// Runs inside a bot worker (`GameBot.search`) and, at a shallow depth, as the cheap synchronous fallback when no pool
// runs or a search fails. It reads only the seat's own view, which for Jungle is the whole public board; the log
// supplies the no-capture count and the positions since the last capture, so the search sees the 100-ply draw and
// treats a repeated position as a draw.

import type { JungleVisibleState } from '@shared/types';
import { JG_CELLS, JG_NO_CAPTURE_LIMIT, jgCell, jgNode, jgQuietPlies } from '@shared/rules/jungle';
import type { JgMove } from '@shared/rules/jungle';
import type { SearchContext } from './search/search-types';
import { seededRandom } from './search/seeded-random';
import type { BotAction } from './bot-decisions';
import {
  DEN, MAX_MOVES, MOVE_MASK, MOVE_SHIFT, atEnemyGate, boardFrom, generate, pieceRank,
} from './jungle-board';
import type { Board } from './jungle-board';
import { W, evaluate } from './jungle-eval';
import { JUNGLE_WEIGHTS } from './jungle-weights';

/** Score of a won game; a nearer win scores higher, a nearer loss lower. */
const WIN = 100_000;
const WIN_BOUND = WIN - 1000;
const MAX_PLY = 96;
const NO_MOVE = 0;

// ── Zobrist keys ──
const keyRandom = seededRandom(0x4a554e47);
const keyWord = (): number => Math.floor(keyRandom() * 4294967296) | 0;
const KEY_1 = Int32Array.from({ length: 17 * 64 }, keyWord);
const KEY_2 = Int32Array.from({ length: 17 * 64 }, keyWord);
const SIDE_1 = keyWord();
const SIDE_2 = keyWord();

/** Both hash words of a position with `side` to move. */
function hashOf(board: Board, side: number): readonly [number, number] {
  let h1 = side === 1 ? SIDE_1 : 0;
  let h2 = side === 1 ? SIDE_2 : 0;
  for (let cell = 0; cell < JG_CELLS; cell++) {
    const piece = board.cells[cell];
    if (piece === 0) continue;
    h1 ^= KEY_1[piece * 64 + cell];
    h2 ^= KEY_2[piece * 64 + cell];
  }
  return [h1, h2];
}

// ── Transposition table ──
interface Table {
  readonly mask: number;
  readonly key: Int32Array;
  /** move (12 bits), depth (7), bound (2), age (8) */
  readonly data: Int32Array;
  readonly score: Int32Array;
}

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

const tables = new Map<number, Table>();
let ageCounter = 0;

function tableFor(bits: number): Table {
  let table = tables.get(bits);
  if (!table) {
    const size = 1 << bits;
    table = { mask: size - 1, key: new Int32Array(size), data: new Int32Array(size), score: new Int32Array(size) };
    tables.set(bits, table);
  }
  return table;
}

/** Per-search state; `ply` indexes the stacks, 0 being the position being decided. */
interface Search {
  readonly board: Board;
  readonly weights: Float64Array;
  readonly table: Table;
  readonly age: number;
  readonly expired: () => boolean;
  readonly maxNodes: number;
  readonly salt: number;
  side: number;
  h1: number;
  h2: number;
  quiet: number;
  nodes: number;
  /** Position hashes of the path, `base` being the root; earlier entries are the game before it */
  readonly path1: Int32Array;
  readonly path2: Int32Array;
  readonly base: number;
  readonly undoTarget: Int8Array;
  readonly undoQuiet: Int16Array;
  readonly moves: Int16Array;
  readonly order: Int32Array;
  readonly killers: Int16Array;
  readonly history: Int32Array;
  readonly scratch: Int16Array;
}

class Stop {}
const STOP = new Stop();

function makeMove(s: Search, move: number, ply: number): void {
  const { cells, loc } = s.board;
  const from = move >> MOVE_SHIFT;
  const to = move & MOVE_MASK;
  const piece = cells[from];
  const target = cells[to];
  s.undoTarget[ply] = target;
  s.undoQuiet[ply] = s.quiet;
  s.h1 ^= KEY_1[piece * 64 + from] ^ KEY_1[piece * 64 + to] ^ SIDE_1;
  s.h2 ^= KEY_2[piece * 64 + from] ^ KEY_2[piece * 64 + to] ^ SIDE_2;
  if (target !== 0) {
    s.h1 ^= KEY_1[target * 64 + to];
    s.h2 ^= KEY_2[target * 64 + to];
    loc[target] = -1;
    s.quiet = 0;
  } else s.quiet++;
  cells[to] = piece;
  cells[from] = 0;
  loc[piece] = to;
  s.side ^= 1;
  s.path1[s.base + ply + 1] = s.h1;
  s.path2[s.base + ply + 1] = s.h2;
}

function unmakeMove(s: Search, move: number, ply: number): void {
  const { cells, loc } = s.board;
  const from = move >> MOVE_SHIFT;
  const to = move & MOVE_MASK;
  const piece = cells[to];
  const target = s.undoTarget[ply];
  cells[from] = piece;
  cells[to] = target;
  loc[piece] = from;
  if (target !== 0) loc[target] = to;
  s.quiet = s.undoQuiet[ply];
  s.h1 = s.path1[s.base + ply];
  s.h2 = s.path2[s.base + ply];
  s.side ^= 1;
}

function countMoves(s: Search, side: number): number {
  return generate(s.board, side, s.scratch, 0, false);
}

function leaf(s: Search): number {
  const mobility = s.weights[W.MOBILITY] === 0 ? 0 : countMoves(s, s.side) - countMoves(s, 1 - s.side);
  return evaluate(s.board, s.side, s.weights, s.quiet, s.h1 ^ s.salt, mobility);
}

function checkTime(s: Search): void {
  if (++s.nodes % 1024 === 0 && (s.expired() || s.nodes >= s.maxNodes)) throw STOP;
}

/** Whether the position on the path repeats one of the same side to move since the last capture. */
function repeated(s: Search, ply: number): boolean {
  const here = s.base + ply;
  for (let back = 4, last = Math.min(s.quiet, here); back <= last; back += 2) {
    if (s.path1[here - back] === s.h1 && s.path2[here - back] === s.h2) return true;
  }
  return false;
}

const victimValue = (s: Search, piece: number): number => s.weights[pieceRank(piece) - 1];

/** Mate scores are stored relative to the node, not the root. */
const toTable = (score: number, ply: number): number => (score > WIN_BOUND ? score + ply : score < -WIN_BOUND ? score - ply : score);
const fromTable = (score: number, ply: number): number => (score > WIN_BOUND ? score - ply : score < -WIN_BOUND ? score + ply : score);

function store(s: Search, depth: number, bound: number, score: number, move: number, ply: number): void {
  const index = s.h1 & s.table.mask;
  const { key, data } = s.table;
  const old = data[index];
  const stale = ((old >> 21) & 255) !== s.age;
  if (!stale && key[index] !== s.h2 && ((old >> 12) & 127) > depth + 2) return;
  key[index] = s.h2;
  data[index] = move | (depth << 12) | (bound << 19) | (s.age << 21);
  s.table.score[index] = toTable(score, ply);
}

function quiesce(s: Search, alpha: number, beta: number, ply: number): number {
  checkTime(s);
  const side = s.side;
  if (atEnemyGate(s.board, side)) return WIN - ply - 1;
  const threatened = atEnemyGate(s.board, 1 - side);
  let best: number;
  if (threatened) best = -(WIN - ply);
  else {
    best = leaf(s);
    if (best >= beta || ply >= MAX_PLY - 1) return best;
    if (best > alpha) alpha = best;
  }
  const start = ply * MAX_MOVES;
  const count = generate(s.board, side, s.moves, start, true);
  if (count === 0) return best;
  const { cells } = s.board;
  for (let index = 0; index < count; index++) {
    const move = s.moves[start + index];
    s.order[start + index] = victimValue(s, cells[move & MOVE_MASK]) - victimValue(s, cells[move >> MOVE_SHIFT]) / 8;
  }
  for (let picked = 0; picked < count; picked++) {
    let top = start + picked;
    for (let rest = top + 1; rest < start + count; rest++) if (s.order[rest] > s.order[top]) top = rest;
    const move = s.moves[top];
    s.moves[top] = s.moves[start + picked];
    s.moves[start + picked] = move;
    s.order[top] = s.order[start + picked];
    makeMove(s, move, ply);
    const score = -quiesce(s, -beta, -alpha, ply + 1);
    unmakeMove(s, move, ply);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

const HISTORY_LIMIT = 60_000;

function negamax(s: Search, depth: number, alpha: number, beta: number, ply: number, pv: boolean): number {
  if (depth <= 0) return quiesce(s, alpha, beta, ply);
  checkTime(s);
  const side = s.side;
  const board = s.board;
  if (atEnemyGate(board, side)) return WIN - ply - 1;
  if (ply >= MAX_PLY - 2) return leaf(s);
  const threatened = atEnemyGate(board, 1 - side);
  const start = ply * MAX_MOVES;
  // A threatened den can only be defended by capturing the runner.
  const count = generate(board, side, s.moves, start, threatened);
  if (count === 0) return -(WIN - ply);
  if (s.quiet >= JG_NO_CAPTURE_LIMIT || repeated(s, ply)) return 0;

  const index = s.h1 & s.table.mask;
  let ttMove = NO_MOVE;
  if (s.table.key[index] === s.h2) {
    const data = s.table.data[index];
    if (((data >> 21) & 255) === s.age) {
      ttMove = data & 4095;
      if (!pv && ((data >> 12) & 127) >= depth) {
        const score = fromTable(s.table.score[index], ply);
        const bound = (data >> 19) & 3;
        if (bound === EXACT || (bound === LOWER && score >= beta) || (bound === UPPER && score <= alpha)) return score;
      }
    }
  }

  const { cells } = board;
  const killer1 = s.killers[ply * 2];
  const killer2 = s.killers[ply * 2 + 1];
  for (let slot = start; slot < start + count; slot++) {
    const move = s.moves[slot];
    const target = cells[move & MOVE_MASK];
    let value: number;
    if (move === ttMove) value = 2_000_000;
    else if (target !== 0) value = 1_000_000 + victimValue(s, target) * 8 - victimValue(s, cells[move >> MOVE_SHIFT]);
    else if (move === killer1) value = 900_000;
    else if (move === killer2) value = 899_999;
    else value = s.history[side * 4096 + move];
    s.order[slot] = value;
  }

  const originalAlpha = alpha;
  let best = -Infinity;
  let bestMove = NO_MOVE;
  for (let picked = 0; picked < count; picked++) {
    let top = start + picked;
    for (let rest = top + 1; rest < start + count; rest++) if (s.order[rest] > s.order[top]) top = rest;
    const move = s.moves[top];
    s.moves[top] = s.moves[start + picked];
    s.moves[start + picked] = move;
    s.order[top] = s.order[start + picked];
    const capture = cells[move & MOVE_MASK] !== 0;
    makeMove(s, move, ply);
    let score: number;
    if (picked === 0) score = -negamax(s, depth - 1, -beta, -alpha, ply + 1, pv);
    else {
      const reduction = depth >= 3 && picked >= 3 && !capture && !threatened ? (picked >= 8 && depth >= 5 ? 2 : 1) : 0;
      score = -negamax(s, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, false);
      if (score > alpha && reduction > 0) score = -negamax(s, depth - 1, -alpha - 1, -alpha, ply + 1, false);
      if (score > alpha && score < beta) score = -negamax(s, depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmakeMove(s, move, ply);
    if (score > best) {
      best = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (!capture) {
            if (s.killers[ply * 2] !== move) {
              s.killers[ply * 2 + 1] = s.killers[ply * 2];
              s.killers[ply * 2] = move;
            }
            const at = side * 4096 + move;
            s.history[at] = Math.min(HISTORY_LIMIT, s.history[at] + depth * depth);
          }
          break;
        }
      }
    }
  }
  store(s, depth, best >= beta ? LOWER : best > originalAlpha ? EXACT : UPPER, best, bestMove, ply);
  return best;
}

// ── Root ──

export interface JungleSearchOptions {
  /** Deepest ply to search. */
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
  /** Plies since the last capture */
  readonly quiet?: number;
  /** Positions after the last capture up to, but not including, the root, oldest first */
  readonly history?: readonly ArrayLike<number>[];
  readonly weights?: Float64Array;
  readonly maxNodes?: number;
  /** log2 of the transposition table's entries */
  readonly tableBits?: number;
  /** Receives the depth and score of each completed iteration */
  readonly onDepth?: (depth: number, score: number, nodes: number) => void;
}

const decode = (move: number): JgMove => ({ from: move >> MOVE_SHIFT, to: move & MOVE_MASK });

interface RootResult {
  readonly move: number;
  readonly score: number;
  /** Score of every root move in order; moves after a cutoff keep -Infinity */
  readonly scores: readonly number[];
}

/** One iteration over the root moves; a move that beats the first after a full re-search is kept in `improved`. */
function searchRoot(
  s: Search, moves: readonly number[], depth: number, alpha: number, beta: number, improved: { move: number },
): RootResult {
  let best = -Infinity;
  let bestMove = moves[0];
  const scores = new Array<number>(moves.length).fill(-Infinity);
  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    makeMove(s, move, 0);
    let score: number;
    if (index === 0) score = -negamax(s, depth - 1, -beta, -alpha, 1, true);
    else {
      score = -negamax(s, depth - 1, -alpha - 1, -alpha, 1, false);
      if (score > alpha && score < beta) score = -negamax(s, depth - 1, -beta, -alpha, 1, true);
    }
    unmakeMove(s, move, 0);
    scores[index] = score;
    if (score > best) {
      best = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        if (index > 0 && score < beta) improved.move = move;
        if (alpha >= beta) break;
      }
    }
  }
  return { move: bestMove, score: best, scores };
}

const WINDOW = 50;

/**
 * Iterative deepening from the shallowest ply with aspiration windows: the best move of the last iteration that
 * finished (or one that beat it before the clock ran out) wins. Returns null when `side` has no legal move.
 */
export function searchBestMove(cells: ArrayLike<number>, side: number, options: JungleSearchOptions): JgMove | null {
  const board = boardFrom(cells);
  const quiet = options.quiet ?? 0;
  const past = options.history ?? [];
  const [h1, h2] = hashOf(board, side);
  const size = past.length + MAX_PLY + 2;
  const path1 = new Int32Array(size);
  const path2 = new Int32Array(size);
  past.forEach((position, index) => {
    // Positions alternate sides back from the root.
    [path1[index], path2[index]] = hashOf(boardFrom(position), (side + past.length - index) & 1);
  });
  const base = past.length;
  path1[base] = h1;
  path2[base] = h2;
  const s: Search = {
    board, weights: options.weights ?? JUNGLE_WEIGHTS, table: tableFor(options.tableBits ?? 20),
    age: (ageCounter = (ageCounter % 250) + 1), expired: options.expired, maxNodes: options.maxNodes ?? Infinity,
    salt: Math.floor(options.random() * 4294967296) | 0, side, h1, h2, quiet, nodes: 0, path1, path2, base,
    undoTarget: new Int8Array(MAX_PLY), undoQuiet: new Int16Array(MAX_PLY),
    moves: new Int16Array(MAX_PLY * MAX_MOVES), order: new Int32Array(MAX_PLY * MAX_MOVES),
    killers: new Int16Array(MAX_PLY * 2), history: new Int32Array(8192), scratch: new Int16Array(MAX_MOVES),
  };

  const rootMoves = new Int16Array(MAX_MOVES);
  const count = generate(board, side, rootMoves, 0, false);
  if (count === 0) return null;
  let order = Array.from(rootMoves.subarray(0, count));
  if (count === 1) return decode(order[0]);
  if (atEnemyGate(board, side)) return decode(order.find((move) => (move & MOVE_MASK) === DEN[1 - side])!);

  let best = order[0];
  let previous = 0;
  const improved = { move: NO_MOVE };
  try {
    for (let depth = 1; depth <= options.maxDepth; depth++) {
      let alpha = depth >= 4 ? previous - WINDOW : -Infinity;
      let beta = depth >= 4 ? previous + WINDOW : Infinity;
      let result: RootResult;
      for (;;) {
        improved.move = NO_MOVE;
        result = searchRoot(s, order, depth, alpha, beta, improved);
        if (result.score <= alpha && alpha > -Infinity) alpha = -Infinity;
        else if (result.score >= beta) {
          best = result.move;
          beta = Infinity;
        } else break;
      }
      best = result.move;
      previous = result.score;
      const scores = result.scores;
      order = order.map((move, index) => ({ move, score: scores[index] }))
        .sort((a, b) => b.score - a.score).map((entry) => entry.move);
      options.onDepth?.(depth, previous, s.nodes);
      if (Math.abs(previous) > WIN_BOUND) break;
    }
  } catch (error) {
    if (error !== STOP) throw error;
    if (improved.move !== NO_MOVE) best = improved.move;
  }
  return decode(best);
}

// ── Strategy entry points ──

/** The searcher's board for a view's cells. */
export function searchCells(cells: JungleVisibleState['cells']): Int8Array {
  return Int8Array.from(cells);
}

export function moveAction(move: JgMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'jungle', action: { type: 'move', from: jgNode(move.from), to: jgNode(move.to) } },
  };
}

/** Plies the synchronous move looks ahead: enough to avoid hanging pieces, cheap enough for a timeout. */
export const QUICK_DEPTH = 4;
export const QUICK_TABLE_BITS = 14;

/** The no-capture count and the positions since the last capture, rebuilt from the public move log. */
export function gameHistory(visible: JungleVisibleState): { readonly quiet: number; readonly history: readonly Int8Array[] } {
  const quiet = jgQuietPlies(visible.log);
  const cells = searchCells(visible.cells);
  const history: Int8Array[] = [];
  for (let step = 1; step <= quiet; step++) {
    const entry = visible.log[visible.log.length - step];
    const from = jgCell(entry.from);
    const to = jgCell(entry.to);
    const side = visible.seats.indexOf(entry.seat);
    if (from === null || to === null || side < 0) break;
    cells[from] = entry.piece + side * 8;
    cells[to] = 0;
    history.unshift(Int8Array.from(cells));
  }
  return { quiet, history };
}

/** The viewer's side when it is their turn in a running match, otherwise null. */
export function sideToMove(visible: JungleVisibleState): 0 | 1 | null {
  const side = visible.seats.indexOf(visible.mySeat);
  return side < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat ? null : side === 0 ? 0 : 1;
}

export interface JungleDecision {
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
  readonly tableBits?: number;
}

/** The move for the viewer, or null off turn or without a legal move. */
export function decideMove(visible: JungleVisibleState, decision: JungleDecision): JgMove | null {
  const side = sideToMove(visible);
  if (side === null) return null;
  return searchBestMove(searchCells(visible.cells), side, { ...decision, ...gameHistory(visible) });
}

/** Search strategy for the bot worker pool. */
export function jungleSearch(visible: JungleVisibleState, context: SearchContext): BotAction | null {
  const move = decideMove(visible, {
    maxDepth: context.budget.maxDepth ?? 40, expired: context.budget.expired, random: context.random,
  });
  return move === null ? null : moveAction(move);
}
