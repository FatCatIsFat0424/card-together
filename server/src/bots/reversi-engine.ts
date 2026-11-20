// ─── Reversi engine: principal-variation search with a transposition table, and an exact endgame solver ───
//
// Positions are bitboards from the side to move (`p`) against the opponent (`o`), see `reversi-board.ts`.
// The midgame search scores leaves with the pattern evaluation (`SCALE` units per disc); the endgame solver
// works in whole discs and proves the game-theoretic result. Both are recursive negamax over module-level
// scratch buffers and allocate nothing per node, so one module instance serves one search at a time.

import { CELL_HI, CELL_LO, flips, lowestBit, moves, out, popcount } from './reversi-board';
import type { Bitboards } from './reversi-board';
import { SCALE, evaluate } from './reversi-eval';
import { PROBCUT, PROBCUT_BUCKETS, PROBCUT_BUCKET_WIDTH, PROBCUT_MAX_DEPTH, PROBCUT_MIN_DEPTH } from './reversi-probcut';

/** Thrown through the recursion when the clock runs out; caught only by the root drivers. */
const STOP = new Error('reversi search stopped');

/** Score bound above any reachable value. */
const INF = 30_000;

const MAX_PLY = 128;
const MOVE_BUFFER = new Int8Array(MAX_PLY * 32);
const KEY_BUFFER = new Int32Array(MAX_PLY * 32);

/** Corners first and the squares diagonally next to an empty corner last: the cheapest useful order. */
const CORNERS_LO = (1 << 0) | (1 << 7);
const CORNERS_HI = (1 << (56 - 32)) | (1 << (63 - 32));
const X_LO = (1 << 9) | (1 << 14);
const X_HI = (1 << (49 - 32)) | (1 << (54 - 32));

/** Static square values used only for move ordering. */
const SQUARE_ORDER: Int8Array = (() => {
  const quarter = [
    [18, 4, 16, 12],
    [4, 0, 6, 8],
    [16, 6, 14, 10],
    [12, 8, 10, 10],
  ];
  const values = new Int8Array(64);
  for (let index = 0; index < 64; index++) {
    const row = index >> 3;
    const col = index & 7;
    values[index] = quarter[Math.min(row, 7 - row)][Math.min(col, 7 - col)];
  }
  return values;
})();

/** Quadrant of every cell, for parity ordering near the end. */
const QUADRANT: Int8Array = Int8Array.from({ length: 64 }, (_, index) => ((index >> 5) << 1) | ((index & 7) >> 2));

// ─── Transposition tables ───

interface Table {
  readonly mask: number;
  readonly keys: Int32Array;
  readonly lower: Int16Array;
  readonly upper: Int16Array;
  readonly depth: Int8Array;
  readonly move: Int8Array;
  readonly generation: Uint8Array;
}

function createTable(bits: number): Table {
  const size = 1 << bits;
  return {
    mask: size - 1,
    keys: new Int32Array(size * 4),
    lower: new Int16Array(size),
    upper: new Int16Array(size),
    depth: new Int8Array(size).fill(-1),
    move: new Int8Array(size).fill(-1),
    generation: new Uint8Array(size),
  };
}

let midTable: Table | null = null;
let endTable: Table | null = null;
let generation = 0;

/** Allocates (or resizes) the tables: about 22 bytes per entry and table. */
function prepareTables(bits: number): void {
  if (!midTable || midTable.mask !== (1 << bits) - 1) {
    midTable = createTable(bits);
    endTable = createTable(bits);
  }
  generation = (generation + 1) & 255;
}

function slotOf(table: Table, pl: number, ph: number, ol: number, oh: number): number {
  let h = Math.imul(pl, 0x9e3779b1) ^ Math.imul(ph ^ 0x5bd1e995, 0x85ebca77);
  h ^= Math.imul(ol ^ (h >>> 15), 0xc2b2ae3d) ^ Math.imul(oh, 0x27d4eb2f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 16;
  return h & table.mask;
}

/** Entry slot holding this exact position, or -1. */
function probe(table: Table, pl: number, ph: number, ol: number, oh: number): number {
  const slot = slotOf(table, pl, ph, ol, oh);
  const key = slot * 4;
  const keys = table.keys;
  return table.depth[slot] >= 0 && keys[key] === pl && keys[key + 1] === ph && keys[key + 2] === ol && keys[key + 3] === oh
    ? slot
    : -1;
}

function store(
  table: Table, pl: number, ph: number, ol: number, oh: number,
  depth: number, alpha: number, beta: number, score: number, move: number,
): void {
  const slot = slotOf(table, pl, ph, ol, oh);
  const key = slot * 4;
  const keys = table.keys;
  const same = keys[key] === pl && keys[key + 1] === ph && keys[key + 2] === ol && keys[key + 3] === oh;
  // Keep a deeper entry from the current search unless this one is for the same position.
  if (!same && table.generation[slot] === generation && table.depth[slot] > depth) return;
  if (!same || table.depth[slot] !== depth) {
    table.lower[slot] = -INF;
    table.upper[slot] = INF;
  }
  keys[key] = pl;
  keys[key + 1] = ph;
  keys[key + 2] = ol;
  keys[key + 3] = oh;
  table.depth[slot] = depth;
  table.generation[slot] = generation;
  if (score > alpha) table.lower[slot] = score;
  if (score < beta) table.upper[slot] = score;
  if (score > alpha || !same) table.move[slot] = move;
}

// ─── Clock ───

let nodes = 0;
let expired: () => boolean = () => false;

function tick(): void {
  if ((++nodes & 1023) === 0 && expired()) throw STOP;
}

// ─── Midgame search ───

/** Fills the ply's buffers with the moves in `ml/mh` and their ordering keys; returns the count. */
function orderMoves(
  pl: number, ph: number, ol: number, oh: number, ml: number, mh: number,
  depth: number, empties: number, ply: number, ttMove: number,
): number {
  const base = ply * 32;
  let count = 0;
  let lo = ml;
  let hi = mh;
  while ((lo | hi) !== 0) {
    let move: number;
    if (lo !== 0) {
      move = lowestBit(lo);
      lo &= lo - 1;
    } else {
      move = 32 + lowestBit(hi);
      hi &= hi - 1;
    }
    let key: number;
    if (move === ttMove) key = 1 << 28;
    else {
      flips(move, pl, ph, ol, oh);
      const nl = pl | out.lo | CELL_LO[move];
      const nh = ph | out.hi | CELL_HI[move];
      const rl = ol & ~out.lo;
      const rh = oh & ~out.hi;
      if (depth >= 3) key = -evaluate(rl, rh, nl, nh, empties - 1);
      else {
        moves(rl, rh, nl, nh);
        key = SQUARE_ORDER[move] * 4 - (popcount(out.lo) + popcount(out.hi)) * 16;
      }
    }
    MOVE_BUFFER[base + count] = move;
    KEY_BUFFER[base + count] = key;
    count++;
  }
  return count;
}

/** Swaps the best remaining move of the ply into position `index` and returns it. */
function pickMove(ply: number, index: number, count: number): number {
  const base = ply * 32;
  let best = index;
  for (let k = index + 1; k < count; k++) if (KEY_BUFFER[base + k] > KEY_BUFFER[base + best]) best = k;
  const move = MOVE_BUFFER[base + best];
  if (best !== index) {
    MOVE_BUFFER[base + best] = MOVE_BUFFER[base + index];
    KEY_BUFFER[base + best] = KEY_BUFFER[base + index];
    MOVE_BUFFER[base + index] = move;
  }
  return move;
}

/** Final score of a finished game in score units: plain disc difference, as the rules count it. */
const finalScore = (pl: number, ph: number, ol: number, oh: number): number => (
  (popcount(pl) + popcount(ph) - popcount(ol) - popcount(oh)) * SCALE
);

/** Frontier node: one ply, each child scored by the evaluation, corners first. */
function frontier(
  pl: number, ph: number, ol: number, oh: number, empties: number, alpha: number, beta: number,
  ml: number, mh: number,
): number {
  let best = -INF;
  for (let group = 0; group < 3; group++) {
    let lo: number;
    let hi: number;
    if (group === 0) {
      lo = ml & CORNERS_LO;
      hi = mh & CORNERS_HI;
    } else if (group === 1) {
      lo = ml & ~CORNERS_LO & ~X_LO;
      hi = mh & ~CORNERS_HI & ~X_HI;
    } else {
      lo = ml & X_LO;
      hi = mh & X_HI;
    }
    while ((lo | hi) !== 0) {
      let move: number;
      if (lo !== 0) {
        move = lowestBit(lo);
        lo &= lo - 1;
      } else {
        move = 32 + lowestBit(hi);
        hi &= hi - 1;
      }
      tick();
      flips(move, pl, ph, ol, oh);
      const score = -evaluate(ol & ~out.lo, oh & ~out.hi, pl | out.lo | CELL_LO[move], ph | out.hi | CELL_HI[move], empties - 1);
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) return best;
        }
      }
    }
  }
  return best;
}

// ─── Multi-ProbCut ───

/** Shallow search depth that predicts a deep search: a third to a half of it, of the same parity. */
export const probCutShallowDepth = (depth: number): number => Math.max(1, depth - 2 * Math.round(depth * 0.3));
/** Cut only when the shallow result clears the window by this many standard deviations. */
const PROBCUT_T = 1.5;
const MAX_SCORE = 64 * SCALE;
let probCut = false;

/** Offset of the (slope, intercept, deviation) triple for a depth and number of empties. */
function probCutEntry(depth: number, empties: number): number {
  const bucket = Math.min(PROBCUT_BUCKETS - 1, Math.floor((60 - empties) / PROBCUT_BUCKET_WIDTH));
  return (bucket * (PROBCUT_MAX_DEPTH + 1) + Math.min(depth, PROBCUT_MAX_DEPTH)) * 3;
}

function pvs(
  pl: number, ph: number, ol: number, oh: number, depth: number, empties: number,
  alpha: number, beta: number, passed: boolean, ply: number,
): number {
  tick();
  if (empties === 0) return finalScore(pl, ph, ol, oh);
  if (depth <= 0) return evaluate(pl, ph, ol, oh, empties);
  moves(pl, ph, ol, oh);
  const ml = out.lo;
  const mh = out.hi;
  if ((ml | mh) === 0) {
    if (passed) return finalScore(pl, ph, ol, oh);
    moves(ol, oh, pl, ph);
    if ((out.lo | out.hi) === 0) return finalScore(pl, ph, ol, oh);
    return -pvs(ol, oh, pl, ph, depth, empties, -beta, -alpha, true, ply + 1);
  }
  if (depth === 1) return frontier(pl, ph, ol, oh, empties, alpha, beta, ml, mh);

  const table = midTable!;
  let ttMove = -1;
  const slot = probe(table, pl, ph, ol, oh);
  if (slot >= 0) {
    ttMove = table.move[slot];
    if (table.depth[slot] >= depth) {
      const lower = table.lower[slot];
      const upper = table.upper[slot];
      if (lower >= beta) return lower;
      if (upper <= alpha) return upper;
      if (lower === upper) return lower;
    }
  }

  // Multi-ProbCut: a shallow search that clears the window by a safe margin predicts the deep result.
  if (probCut && beta - alpha === 1 && depth >= PROBCUT_MIN_DEPTH) {
    const entry = probCutEntry(depth, empties);
    const shallow = probCutShallowDepth(depth);
    const slope = PROBCUT[entry];
    const intercept = PROBCUT[entry + 1];
    const margin = PROBCUT_T * PROBCUT[entry + 2];
    const high = Math.ceil((beta + margin - intercept) / slope);
    if (high < MAX_SCORE && pvs(pl, ph, ol, oh, shallow, empties, high - 1, high, passed, ply) >= high) return beta;
    const low = Math.floor((alpha - margin - intercept) / slope);
    if (low > -MAX_SCORE && pvs(pl, ph, ol, oh, shallow, empties, low, low + 1, passed, ply) <= low) return alpha;
  }

  const count = orderMoves(pl, ph, ol, oh, ml, mh, depth, empties, ply, ttMove);
  const alpha0 = alpha;
  let best = -INF;
  let bestMove = -1;
  for (let index = 0; index < count; index++) {
    const move = pickMove(ply, index, count);
    flips(move, pl, ph, ol, oh);
    const nl = pl | out.lo | CELL_LO[move];
    const nh = ph | out.hi | CELL_HI[move];
    const rl = ol & ~out.lo;
    const rh = oh & ~out.hi;
    let score: number;
    if (index === 0) score = -pvs(rl, rh, nl, nh, depth - 1, empties - 1, -beta, -alpha, false, ply + 1);
    else {
      score = -pvs(rl, rh, nl, nh, depth - 1, empties - 1, -alpha - 1, -alpha, false, ply + 1);
      if (score > alpha && score < beta) score = -pvs(rl, rh, nl, nh, depth - 1, empties - 1, -beta, -score, false, ply + 1);
    }
    if (score > best) {
      best = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) break;
      }
    }
  }
  store(table, pl, ph, ol, oh, depth, alpha0, beta, best, bestMove);
  return best;
}

// ─── Endgame solver (whole discs) ───

/** Below this many empties the solver skips the table and mobility ordering. */
const SHALLOW_EMPTIES = 6;
/** From this many empties the solver uses the transposition table. */
const TABLE_EMPTIES = 9;
/** From this many empties the solver's move order also weighs the evaluation (a quarter of it). */
const ORDER_EVAL_EMPTIES = 14;
const ORDER_EVAL_SHIFT = 2;

/** Disc difference after the last empty square is filled (or left empty when nobody can play it). */
function lastSquare(pl: number, ph: number, ol: number, oh: number, square: number): number {
  const discs = popcount(pl) + popcount(ph);
  // 63 discs on the board: own minus opponent before the last move.
  const diff = 2 * discs - 63;
  flips(square, pl, ph, ol, oh);
  let flipped = popcount(out.lo) + popcount(out.hi);
  if (flipped > 0) return diff + 2 * flipped + 1;
  flips(square, ol, oh, pl, ph);
  flipped = popcount(out.lo) + popcount(out.hi);
  if (flipped > 0) return diff - 2 * flipped - 1;
  return diff;
}

const finalDiscs = (pl: number, ph: number, ol: number, oh: number): number => (
  popcount(pl) + popcount(ph) - popcount(ol) - popcount(oh)
);

const SHALLOW_SQUARES = new Int8Array(MAX_PLY * 8);

/** Few empties: plain alpha-beta over the empty squares, odd quadrants first. */
function solveShallow(
  pl: number, ph: number, ol: number, oh: number, empties: number, alpha: number, beta: number, passed: boolean, ply: number,
): number {
  tick();
  let lo = ~(pl | ol);
  let hi = ~(ph | oh);
  if (empties === 1) {
    const square = lo !== 0 ? lowestBit(lo) : 32 + lowestBit(hi);
    return lastSquare(pl, ph, ol, oh, square);
  }
  const base = ply * 8;
  let parity = 0;
  let count = 0;
  while ((lo | hi) !== 0) {
    let square: number;
    if (lo !== 0) {
      square = lowestBit(lo);
      lo &= lo - 1;
    } else {
      square = 32 + lowestBit(hi);
      hi &= hi - 1;
    }
    parity ^= 1 << QUADRANT[square];
    SHALLOW_SQUARES[base + count++] = square;
  }
  let best = -INF;
  let moved = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < count; k++) {
      const square = SHALLOW_SQUARES[base + k];
      const odd = (parity >> QUADRANT[square]) & 1;
      if (odd !== (pass === 0 ? 1 : 0)) continue;
      flips(square, pl, ph, ol, oh);
      if ((out.lo | out.hi) === 0) continue;
      moved = true;
      const nl = pl | out.lo | CELL_LO[square];
      const nh = ph | out.hi | CELL_HI[square];
      const score = -solveShallow(ol & ~out.lo, oh & ~out.hi, nl, nh, empties - 1, -beta, -alpha, false, ply + 1);
      if (score > best) {
        best = score;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) return best;
        }
      }
    }
  }
  if (moved) return best;
  if (passed) return finalDiscs(pl, ph, ol, oh);
  return -solveShallow(ol, oh, pl, ph, empties, -beta, -alpha, true, ply + 1);
}

function solveNode(
  pl: number, ph: number, ol: number, oh: number, empties: number, alpha: number, beta: number, passed: boolean, ply: number,
): number {
  if (empties <= SHALLOW_EMPTIES) return solveShallow(pl, ph, ol, oh, empties, alpha, beta, passed, ply);
  tick();
  moves(pl, ph, ol, oh);
  const ml = out.lo;
  const mh = out.hi;
  if ((ml | mh) === 0) {
    if (passed) return finalDiscs(pl, ph, ol, oh);
    moves(ol, oh, pl, ph);
    if ((out.lo | out.hi) === 0) return finalDiscs(pl, ph, ol, oh);
    return -solveNode(ol, oh, pl, ph, empties, -beta, -alpha, true, ply + 1);
  }

  const table = endTable!;
  let ttMove = -1;
  const useTable = empties >= TABLE_EMPTIES;
  if (useTable) {
    const slot = probe(table, pl, ph, ol, oh);
    if (slot >= 0) {
      ttMove = table.move[slot];
      const lower = table.lower[slot];
      const upper = table.upper[slot];
      if (lower >= beta) return lower;
      if (upper <= alpha) return upper;
      if (lower === upper) return lower;
      if (lower > alpha) alpha = lower;
      if (upper < beta) beta = upper;
    }
  }

  // Fastest first: the reply that leaves the opponent the fewest moves, corners breaking ties; with many
  // empties the evaluation of the reply refines the order.
  const base = ply * 32;
  let count = 0;
  let lo = ml;
  let hi = mh;
  while ((lo | hi) !== 0) {
    let move: number;
    if (lo !== 0) {
      move = lowestBit(lo);
      lo &= lo - 1;
    } else {
      move = 32 + lowestBit(hi);
      hi &= hi - 1;
    }
    let key: number;
    if (move === ttMove) key = 1 << 28;
    else {
      flips(move, pl, ph, ol, oh);
      const nl = pl | out.lo | CELL_LO[move];
      const nh = ph | out.hi | CELL_HI[move];
      const rl = ol & ~out.lo;
      const rh = oh & ~out.hi;
      moves(rl, rh, nl, nh);
      const replies = popcount(out.lo) + popcount(out.hi);
      key = -replies * 64 + SQUARE_ORDER[move];
      if (replies === 0) key += 512;
      if (empties >= ORDER_EVAL_EMPTIES) key -= evaluate(rl, rh, nl, nh, empties - 1) >> ORDER_EVAL_SHIFT;
    }
    MOVE_BUFFER[base + count] = move;
    KEY_BUFFER[base + count] = key;
    count++;
  }

  const alpha0 = alpha;
  let best = -INF;
  let bestMove = -1;
  for (let index = 0; index < count; index++) {
    const move = pickMove(ply, index, count);
    flips(move, pl, ph, ol, oh);
    const nl = pl | out.lo | CELL_LO[move];
    const nh = ph | out.hi | CELL_HI[move];
    const rl = ol & ~out.lo;
    const rh = oh & ~out.hi;
    let score: number;
    if (index === 0) score = -solveNode(rl, rh, nl, nh, empties - 1, -beta, -alpha, false, ply + 1);
    else {
      score = -solveNode(rl, rh, nl, nh, empties - 1, -alpha - 1, -alpha, false, ply + 1);
      if (score > alpha && score < beta) score = -solveNode(rl, rh, nl, nh, empties - 1, -beta, -score, false, ply + 1);
    }
    if (score > best) {
      best = score;
      bestMove = move;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) break;
      }
    }
  }
  if (useTable) store(table, pl, ph, ol, oh, empties, alpha0, beta, best, bestMove);
  return best;
}

// ─── Root drivers ───

export interface EngineLimits {
  /** Deepest midgame iteration */
  readonly maxDepth: number;
  /** True once the clock has run out; the search then returns its best completed result. */
  readonly expired: () => boolean;
  /**
   * Milliseconds elapsed since the decision started and the budget, or null for a clock-free search.
   * Used to split time between the midgame search and an endgame solve.
   */
  readonly clock: { readonly elapsedMs: () => number; readonly budgetMs: number } | null;
  /** Try to prove the result once this few squares are empty */
  readonly solveEmpties: number;
  /** Transposition table size as a power of two */
  readonly tableBits: number;
  /** Prune with Multi-ProbCut (default); offline tools turn it off for exact fixed-depth values */
  readonly probCut?: boolean;
}

export interface EngineResult {
  /** Chosen cell, or -1 when the side to move has no legal move */
  readonly move: number;
  /** Score for the side to move: score units for a midgame estimate, discs when `solved` */
  readonly score: number;
  /** Deepest completed midgame iteration */
  readonly depth: number;
  /** Whether the endgame solver proved the result (win, draw, or loss) */
  readonly solved: boolean;
  readonly nodes: number;
}

export interface RootMove {
  readonly move: number;
  readonly pl: number;
  readonly ph: number;
  readonly ol: number;
  readonly oh: number;
}

/** Legal moves of a position with the resulting child positions (from the opponent's side). */
export function rootMoves(board: Bitboards): RootMove[] {
  const { pl, ph, ol, oh } = board;
  moves(pl, ph, ol, oh);
  let lo = out.lo;
  let hi = out.hi;
  const result: RootMove[] = [];
  while ((lo | hi) !== 0) {
    let move: number;
    if (lo !== 0) {
      move = lowestBit(lo);
      lo &= lo - 1;
    } else {
      move = 32 + lowestBit(hi);
      hi &= hi - 1;
    }
    flips(move, pl, ph, ol, oh);
    result.push({ move, pl: ol & ~out.lo, ph: oh & ~out.hi, ol: pl | out.lo | CELL_LO[move], oh: ph | out.hi | CELL_HI[move] });
  }
  return result;
}

export const emptiesOf = (board: Bitboards): number => 64 - popcount(board.pl | board.ol) - popcount(board.ph | board.oh);

/** A move of an unfinished iteration that already proved better than the previous best, or -1. */
let improvedMove = -1;

/** One midgame iteration over the root moves (best first); returns the best move and its score. */
function rootIteration(
  children: readonly RootMove[], depth: number, empties: number, alpha: number, beta: number,
): { move: number; score: number; index: number } {
  let best = -INF;
  let bestIndex = 0;
  improvedMove = -1;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    let score: number;
    if (index === 0) score = -pvs(child.pl, child.ph, child.ol, child.oh, depth - 1, empties - 1, -beta, -alpha, false, 1);
    else {
      const floor = Math.max(alpha, best);
      score = -pvs(child.pl, child.ph, child.ol, child.oh, depth - 1, empties - 1, -floor - 1, -floor, false, 1);
      if (score > floor && score < beta) score = -pvs(child.pl, child.ph, child.ol, child.oh, depth - 1, empties - 1, -beta, -score, false, 1);
    }
    if (score > best) {
      best = score;
      bestIndex = index;
      if (index > 0 && score > alpha) improvedMove = child.move;
      if (best >= beta) break;
    }
  }
  return { move: children[bestIndex].move, score: best, index: bestIndex };
}

/**
 * Iterative-deepening midgame search, then (with few enough empties) an endgame solve that proves a win, draw,
 * or loss. The best move of the deepest completed iteration wins; an interrupted iteration still counts
 * when its first (previously best) move is done and a later move beat it.
 */
export function searchPosition(board: Bitboards, limits: EngineLimits): EngineResult {
  prepareTables(limits.tableBits);
  nodes = 0;
  expired = limits.expired;
  probCut = limits.probCut ?? true;
  const children = rootMoves(board);
  if (children.length === 0) return { move: -1, score: 0, depth: 0, solved: false, nodes: 0 };
  if (children.length === 1) return { move: children[0].move, score: 0, depth: 0, solved: false, nodes: 0 };
  const empties = emptiesOf(board);
  const solving = empties <= limits.solveEmpties;
  // With a solve ahead, the midgame search only prepares the move order and a fallback.
  const midShare = !solving ? 1 : empties <= limits.solveEmpties - 2 ? 0.05 : 0.25;
  const order = children.slice();
  let bestMove = order[0].move;
  let bestScore = 0;
  let completed = 0;
  const maxDepth = Math.min(limits.maxDepth, empties);
  try {
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (depth > 1 && limits.clock && limits.clock.elapsedMs() > limits.clock.budgetMs * midShare) break;
      if (depth > 1 && solving && !limits.clock && depth > 4) break;
      let result: { move: number; score: number; index: number };
      if (depth >= 3) {
        const window = 2 * SCALE;
        let alpha = bestScore - window;
        let beta = bestScore + window;
        for (;;) {
          result = rootIteration(order, depth, empties, alpha, beta);
          if (result.score <= alpha) alpha = -INF;
          else if (result.score >= beta) beta = INF;
          else break;
          if (alpha === -INF && beta === INF) {
            result = rootIteration(order, depth, empties, alpha, beta);
            break;
          }
        }
      } else result = rootIteration(order, depth, empties, -INF, INF);
      const [chosen] = order.splice(result.index, 1);
      order.unshift(chosen);
      bestMove = result.move;
      bestScore = result.score;
      completed = depth;
    }
  } catch (error) {
    if (error !== STOP) throw error;
    if (improvedMove >= 0) bestMove = improvedMove;
  }

  if (solving && !limits.expired()) {
    const solved = solveRoot(order, empties);
    if (solved.move >= 0) return { move: solved.move, score: solved.score, depth: completed, solved: true, nodes };
    // Interrupted: never keep a move already proven lost while a draw or an unproven move remains.
    if (solved.lost.has(bestMove)) {
      const unproven = order.find((child) => !solved.lost.has(child.move));
      bestMove = solved.drawMove >= 0 ? solved.drawMove : unproven?.move ?? bestMove;
    }
  }
  return { move: bestMove, score: bestScore, depth: completed, solved: false, nodes };
}

interface RootProof {
  /** The proven choice (first win, else first draw, else the first move when all lose), or -1 when interrupted */
  readonly move: number;
  /** Disc difference bound: at least 1 for a win, 0 for a draw, at most -1 for a loss */
  readonly score: number;
  readonly drawMove: number;
  readonly lost: ReadonlySet<number>;
}

/**
 * Proves the result of every root move with a null window around a draw: the first winning move wins, then
 * the first drawing one; when every move loses, the first (midgame best) move stands. An interrupted proof
 * still reports the moves it showed to draw or lose.
 */
function solveRoot(order: readonly RootMove[], empties: number): RootProof {
  let drawMove = -1;
  const lost = new Set<number>();
  try {
    for (const child of order) {
      const score = -solveNode(child.pl, child.ph, child.ol, child.oh, empties - 1, -1, 1, false, 1);
      if (score >= 1) return { move: child.move, score, drawMove, lost };
      if (score === 0 && drawMove < 0) drawMove = child.move;
      if (score < 0) lost.add(child.move);
    }
  } catch (error) {
    if (error !== STOP) throw error;
    return { move: -1, score: 0, drawMove, lost };
  }
  return drawMove >= 0 ? { move: drawMove, score: 0, drawMove, lost } : { move: order[0].move, score: -1, drawMove, lost };
}

/** Exact disc difference for the side to move under perfect play by both sides (tests and offline tools). */
export function solveExact(board: Bitboards, tableBits = 16): number {
  prepareTables(tableBits);
  nodes = 0;
  expired = () => false;
  return solveNode(board.pl, board.ph, board.ol, board.oh, emptiesOf(board), -64, 64, false, 0);
}

/** Midgame score of a position at a fixed depth (offline tools). */
export function searchScore(board: Bitboards, depth: number, tableBits = 16, withProbCut = false): number {
  prepareTables(tableBits);
  nodes = 0;
  expired = () => false;
  probCut = withProbCut;
  return pvs(board.pl, board.ph, board.ol, board.oh, depth, emptiesOf(board), -INF, INF, false, 0);
}

export const searchedNodes = (): number => nodes;
