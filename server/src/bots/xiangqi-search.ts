// ─── Xiangqi search: iterative-deepening alpha-beta with quiescence, MVV-LVA and killer ordering ───
//
// Runs inside a bot worker (`GameBot.search`) and, shallow and time-capped, as the synchronous move that serves
// other seats' timeouts. It reads only the seat's own view, which for Xiangqi is the whole public game, and uses
// the shared rules engine, so every move it can return is one the server accepts.

import type { XiangqiVisibleState } from '@shared/types';
import {
  XQ_ADVISOR, XQ_CANNON, XQ_CELLS, XQ_CHARIOT, XQ_COL, XQ_ELEPHANT, XQ_GENERAL, XQ_HORSE, XQ_ROW, XQ_SOLDIER,
  xqApply, xqEngineBoard, xqFrom, xqGenerate, xqInCheckEngine, xqLegalEngineMoves, xqNode, xqOpponent, xqPlies,
  xqSign, xqTo, xqVerdict,
} from '@shared/rules/xiangqi';
import type { XqBoard, XqEngineBoard, XqMove, XqPly, XqSide } from '@shared/rules/xiangqi';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

const MATE = 100_000;
/** Scores beyond this are mates found in the tree. */
const MATE_BOUND = MATE - 1_000;
/** Capture-only plies past the search horizon. */
const QUIESCENCE_PLIES = 8;
const MAX_PLY = 64;

// ─── Evaluation: material plus position, from the owner's point of view ───

/** Base values: chariot 9, cannon 4.5, horse 4, advisor and elephant 2, soldier 1 (2 across the river). */
function pieceScore(kind: number, col: number, row: number): number {
  // `row` counts from the owner's far side: 0 is the opponent's back rank, 9 the owner's.
  const central = 4 - Math.abs(col - 4);
  switch (kind) {
    case XQ_GENERAL: return row === 9 ? 0 : -12 * (9 - row);
    case XQ_ADVISOR: return 200 + (col === 4 && row === 8 ? 10 : 0);
    case XQ_ELEPHANT: return 200 + (col === 4 && row === 7 ? 10 : 0);
    case XQ_HORSE: {
      const advanced = row <= 4 ? (row === 0 ? 10 : 30) : row === 9 ? -20 : 0;
      return 400 + central * 6 + advanced + (col === 0 || col === 8 ? -20 : 0);
    }
    case XQ_CHARIOT: return 900 + (row <= 4 ? 20 : 0) + (row === 9 ? -10 : 0) + (col === 3 || col === 5 ? 8 : 0);
    case XQ_CANNON: return 450 + (col === 4 ? 20 : 0) + (row === 7 ? 5 : 0);
    case XQ_SOLDIER: {
      if (row >= 5) return 100 + (row === 5 ? 15 : 0) + (col === 4 ? 10 : 0);
      const near = col >= 3 && col <= 5 ? 3 : col === 2 || col === 6 ? 2 : col === 1 || col === 7 ? 1 : 0;
      return row === 0 ? 130 + near * 5 : 180 + (4 - row) * 15 + near * 10;
    }
    default: return 0;
  }
}

/** Signed value (red positive) of engine code `code` on each cell, indexed `(code + 7) * 90 + cell`. */
const VALUES: Int32Array = (() => {
  const table = new Int32Array(15 * XQ_CELLS);
  for (let code = -7; code <= 7; code++) {
    if (code === 0) continue;
    for (let cell = 0; cell < XQ_CELLS; cell++) {
      const red = code > 0;
      const col = red ? XQ_COL[cell] : 8 - XQ_COL[cell];
      const row = red ? XQ_ROW[cell] : 9 - XQ_ROW[cell];
      table[(code + 7) * XQ_CELLS + cell] = (red ? 1 : -1) * pieceScore(Math.abs(code), col, row);
    }
  }
  return table;
})();

const value = (code: number, cell: number): number => (code === 0 ? 0 : VALUES[(code + 7) * XQ_CELLS + cell]);

/** Ordering weight of a piece as victim or attacker. */
const ORDER_VALUE = [0, 2_000, 20, 20, 40, 90, 45, 10];

// ─── Hashing for repetitions ───

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/** Two independent 32-bit keys per piece and cell, combined into one safe integer. */
const ZOBRIST: { readonly low: Uint32Array; readonly high: Uint32Array; readonly side: readonly [number, number] } = (() => {
  const next = mulberry(0x5eed_c0de);
  const low = new Uint32Array(15 * XQ_CELLS).map(() => next());
  const high = new Uint32Array(15 * XQ_CELLS).map(() => next() & 0x1fffff);
  return { low, high, side: [next(), next() & 0x1fffff] };
})();

interface Hash {
  low: number;
  high: number;
}

function hashOf(board: XqEngineBoard, side: XqSide): Hash {
  let low = side === 1 ? ZOBRIST.side[0] : 0;
  let high = side === 1 ? ZOBRIST.side[1] : 0;
  for (let cell = 0; cell < XQ_CELLS; cell++) {
    if (board[cell] === 0) continue;
    const key = (board[cell] + 7) * XQ_CELLS + cell;
    low ^= ZOBRIST.low[key];
    high ^= ZOBRIST.high[key];
  }
  return { low: low >>> 0, high: high >>> 0 };
}

const hashNumber = (hash: Hash): number => hash.high * 0x1_0000_0000 + hash.low;

// ─── Root classification ───

type RootKind = 'win' | 'loss' | 'draw' | 'open';

/** What the rules say right after `move`: an immediate win, a perpetual-check loss, a forced draw, or play on. */
function classifyRoot(board: XqBoard, side: XqSide, plies: readonly XqPly[], move: XqMove): RootKind {
  const piece = board[move.from]!;
  const after = xqApply(board, move.from, move.to);
  const check = xqInCheckEngine(xqEngineBoard(after), xqOpponent(side));
  const verdict = xqVerdict(after, xqOpponent(side), [...plies, {
    from: move.from, to: move.to, piece, captured: board[move.to], check,
  }]);
  if (verdict === null) return 'open';
  if (verdict.loser === null) return 'draw';
  return verdict.loser === side ? 'loss' : 'win';
}

interface RootMove {
  readonly move: number;
  readonly kind: RootKind;
}

/**
 * Legal root moves with their rule outcome. Moves that lose by perpetual check are dropped while any other move
 * exists; the server would accept them, but a bot must not throw the game away.
 */
function rootMoves(board: XqBoard, side: XqSide, plies: readonly XqPly[]): RootMove[] {
  const legal = xqLegalEngineMoves(xqEngineBoard(board), side)
    .map((move) => ({ move, kind: classifyRoot(board, side, plies, { from: xqFrom(move), to: xqTo(move) }) }));
  const safe = legal.filter((entry) => entry.kind !== 'loss');
  return safe.length > 0 ? safe : legal;
}

/** Hashes of the positions since the last capture, which a line returning to them repeats. */
function historyHashes(board: XqBoard, side: XqSide, plies: readonly XqPly[]): Set<number> {
  const engine = xqEngineBoard(board);
  const seen = new Set<number>([hashNumber(hashOf(engine, side))]);
  let toMove = side;
  for (let index = plies.length - 1; index >= 0 && plies[index].captured === null; index--) {
    const ply = plies[index];
    engine[ply.from] = engine[ply.to];
    engine[ply.to] = 0;
    toMove = xqOpponent(toMove);
    seen.add(hashNumber(hashOf(engine, toMove)));
  }
  return seen;
}

// ─── Search ───

class Stop extends Error {}

export interface XiangqiSearchOptions {
  readonly maxDepth: number;
  readonly expired: () => boolean;
  readonly random: () => number;
}

interface Searcher {
  readonly board: XqEngineBoard;
  side: XqSide;
  /** Material and position, red positive */
  score: number;
  hash: Hash;
  nodes: number;
  readonly path: number[];
  readonly history: Set<number>;
  readonly killers: Int32Array;
  readonly expired: () => boolean;
}

function make(searcher: Searcher, move: number): number {
  const { board } = searcher;
  const from = xqFrom(move);
  const to = xqTo(move);
  const piece = board[from];
  const captured = board[to];
  searcher.score += value(piece, to) - value(piece, from) - value(captured, to);
  const moved = (piece + 7) * XQ_CELLS;
  let low = searcher.hash.low ^ ZOBRIST.low[moved + from] ^ ZOBRIST.low[moved + to] ^ ZOBRIST.side[0];
  let high = searcher.hash.high ^ ZOBRIST.high[moved + from] ^ ZOBRIST.high[moved + to] ^ ZOBRIST.side[1];
  if (captured !== 0) {
    low ^= ZOBRIST.low[(captured + 7) * XQ_CELLS + to];
    high ^= ZOBRIST.high[(captured + 7) * XQ_CELLS + to];
  }
  searcher.hash = { low: low >>> 0, high: high >>> 0 };
  board[to] = piece;
  board[from] = 0;
  searcher.side = xqOpponent(searcher.side);
  return captured;
}

function unmake(searcher: Searcher, move: number, captured: number, hash: Hash, score: number): void {
  const from = xqFrom(move);
  const to = xqTo(move);
  searcher.board[from] = searcher.board[to];
  searcher.board[to] = captured;
  searcher.side = xqOpponent(searcher.side);
  searcher.hash = hash;
  searcher.score = score;
}

/** Score for the side to move. */
const evaluate = (searcher: Searcher): number => searcher.score * xqSign(searcher.side);

/** Captures first by most valuable victim and least valuable attacker, then killer moves, then the rest. */
function ordered(searcher: Searcher, moves: number[], ply: number): number[] {
  const { board } = searcher;
  const killerA = searcher.killers[ply * 2];
  const killerB = searcher.killers[ply * 2 + 1];
  const keyed = moves.map((move) => {
    const victim = Math.abs(board[xqTo(move)]);
    const attacker = Math.abs(board[xqFrom(move)]);
    const key = victim !== 0 ? 1_000_000 + ORDER_VALUE[victim] * 16 - ORDER_VALUE[attacker] / 16
      : move === killerA ? 900_000 : move === killerB ? 800_000 : 0;
    return { move, key };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((entry) => entry.move);
}

function tick(searcher: Searcher): void {
  if ((++searcher.nodes & 1023) === 0 && searcher.expired()) throw new Stop();
}

function quiesce(searcher: Searcher, alpha: number, beta: number, ply: number, depth: number): number {
  tick(searcher);
  const stand = evaluate(searcher);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (depth >= QUIESCENCE_PLIES || ply >= MAX_PLY) return stand;
  const moves: number[] = [];
  xqGenerate(searcher.board, searcher.side, moves, true);
  for (const move of ordered(searcher, moves, ply)) {
    const hash = searcher.hash;
    const score = searcher.score;
    const side = searcher.side;
    const captured = make(searcher, move);
    if (xqInCheckEngine(searcher.board, side)) {
      unmake(searcher, move, captured, hash, score);
      continue;
    }
    const result = -quiesce(searcher, -beta, -alpha, ply + 1, depth + 1);
    unmake(searcher, move, captured, hash, score);
    if (result >= beta) return result;
    if (result > alpha) alpha = result;
  }
  return alpha;
}

function negamax(searcher: Searcher, depth: number, alpha: number, beta: number, ply: number): number {
  tick(searcher);
  const key = hashNumber(searcher.hash);
  // Returning to an earlier position of this line or of the game counts as a draw.
  if (ply > 0 && (searcher.history.has(key) || searcher.path.includes(key))) return 0;
  const side = searcher.side;
  const inCheck = xqInCheckEngine(searcher.board, side);
  // Evasions are searched one ply deeper, so a check at the horizon is not mistaken for a quiet position.
  const remaining = inCheck && ply < MAX_PLY / 2 ? depth + 1 : depth;
  if (remaining <= 0) return quiesce(searcher, alpha, beta, ply, 0);
  const moves: number[] = [];
  xqGenerate(searcher.board, side, moves);
  searcher.path.push(key);
  let best = -Infinity;
  let legal = 0;
  try {
    for (const move of ordered(searcher, moves, ply)) {
      const hash = searcher.hash;
      const score = searcher.score;
      const captured = make(searcher, move);
      if (xqInCheckEngine(searcher.board, side)) {
        unmake(searcher, move, captured, hash, score);
        continue;
      }
      legal++;
      const result = -negamax(searcher, remaining - 1, -beta, -alpha, ply + 1);
      unmake(searcher, move, captured, hash, score);
      if (result > best) best = result;
      if (result > alpha) alpha = result;
      if (alpha >= beta) {
        if (captured === 0 && searcher.killers[ply * 2] !== move) {
          searcher.killers[ply * 2 + 1] = searcher.killers[ply * 2];
          searcher.killers[ply * 2] = move;
        }
        break;
      }
    }
  } finally {
    searcher.path.pop();
  }
  // No legal move loses, whether checkmated or stalemated; sooner losses score lower.
  return legal === 0 ? -MATE + ply : best;
}

/**
 * Iterative deepening from one ply: the best move of the deepest finished iteration wins (or of a partly finished
 * one, once its first move is done), and equally scored moves are chosen between at random. A move that wins on
 * the spot is played at once; draws by the rules score zero. Returns null without a legal move.
 */
export function xiangqiBestMove(board: XqBoard, side: XqSide, plies: readonly XqPly[], options: XiangqiSearchOptions): XqMove | null {
  const roots = rootMoves(board, side, plies);
  if (roots.length === 0) return null;
  const decode = (move: number): XqMove => ({ from: xqFrom(move), to: xqTo(move) });
  const win = roots.find((entry) => entry.kind === 'win');
  if (win) return decode(win.move);
  if (roots.length === 1) return decode(roots[0].move);

  const engine = xqEngineBoard(board);
  let score = 0;
  for (let cell = 0; cell < XQ_CELLS; cell++) score += value(engine[cell], cell);
  const searcher: Searcher = {
    board: engine, side, score, hash: hashOf(engine, side), nodes: 0, path: [],
    history: historyHashes(board, side, plies), killers: new Int32Array(MAX_PLY * 2 + 4),
    expired: options.expired,
  };
  const kinds = new Map(roots.map((entry) => [entry.move, entry.kind]));
  let order = ordered(searcher, roots.map((entry) => entry.move), 0);
  let best = order[0];
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    const scores: { move: number; score: number }[] = [];
    let alpha = -Infinity;
    let stopped = false;
    try {
      for (const move of order) {
        let result: number;
        if (kinds.get(move) === 'draw') {
          result = 0;
        } else {
          const hash = searcher.hash;
          const before = searcher.score;
          const captured = make(searcher, move);
          try {
            // A window one below the best keeps equal scores exact, so ties can be chosen at random.
            result = -negamax(searcher, depth - 1, -Infinity, -(alpha - 1), 1);
          } finally {
            unmake(searcher, move, captured, hash, before);
          }
        }
        scores.push({ move, score: result });
        if (result > alpha) alpha = result;
      }
    } catch (error) {
      if (!(error instanceof Stop)) throw error;
      stopped = true;
    }
    if (scores.length === 0) break;
    // A stopped iteration still counts once the previous best move (searched first) has its score.
    const ranked = [...scores].sort((a, b) => b.score - a.score);
    const top = ranked.filter((entry) => entry.score === ranked[0].score);
    best = top[Math.floor(options.random() * top.length)].move;
    order = [...ranked.map((entry) => entry.move), ...order.filter((move) => !scores.some((entry) => entry.move === move))];
    if (stopped || options.expired() || Math.abs(ranked[0].score) >= MATE_BOUND) break;
  }
  return decode(best);
}

/** Noise added to Easy's two-ply scores: about one and a half soldiers. */
const EASY_NOISE = 150;

/**
 * Easy: each move is scored by the opponent's best static reply (two plies, no quiescence), plus noise, so it
 * avoids leaving pieces hanging to a single capture but misses deeper tactics. It still takes a mate in one and
 * never loses by perpetual check while another move exists.
 */
export function xiangqiEasyMove(board: XqBoard, side: XqSide, plies: readonly XqPly[], random: () => number): XqMove | null {
  const roots = rootMoves(board, side, plies);
  if (roots.length === 0) return null;
  const win = roots.find((entry) => entry.kind === 'win');
  const decode = (move: number): XqMove => ({ from: xqFrom(move), to: xqTo(move) });
  if (win) return decode(win.move);
  const engine = xqEngineBoard(board);
  let total = 0;
  for (let cell = 0; cell < XQ_CELLS; cell++) total += value(engine[cell], cell);
  const searcher: Searcher = {
    board: engine, side, score: total, hash: hashOf(engine, side), nodes: 0, path: [], history: new Set(),
    killers: new Int32Array(8), expired: () => false,
  };
  let best: { move: number; score: number } | null = null;
  for (const { move, kind } of roots) {
    let score = 0;
    if (kind !== 'draw') {
      const hash = searcher.hash;
      const before = searcher.score;
      const captured = make(searcher, move);
      let reply = -Infinity;
      for (const answer of xqLegalEngineMoves(searcher.board, searcher.side)) {
        const answerHash = searcher.hash;
        const answerScore = searcher.score;
        const taken = make(searcher, answer);
        // After the reply it is this side's turn again, so the evaluation is already from its point of view.
        reply = Math.max(reply, -evaluate(searcher));
        unmake(searcher, answer, taken, answerHash, answerScore);
      }
      unmake(searcher, move, captured, hash, before);
      score = reply === -Infinity ? MATE : -reply;
    }
    score += random() * EASY_NOISE;
    if (!best || score > best.score) best = { move, score };
  }
  return best ? decode(best.move) : null;
}

// ─── Bot actions from a view ───

/** The viewer's side, board, and history when it is their turn in a running match, otherwise null. */
export function xiangqiTurn(visible: XiangqiVisibleState): { side: XqSide; board: XqBoard; plies: XqPly[] } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  return { side: index === 0 ? 0 : 1, board: visible.board, plies: xqPlies(visible.log) };
}

export function moveAction(move: XqMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'xiangqi', action: { type: 'move', from: xqNode(move.from), to: xqNode(move.to) } },
  };
}

/** Plies the synchronous hard move searches, within `QUICK_BUDGET_MS`. */
export const QUICK_DEPTH = 3;
export const QUICK_BUDGET_MS = 150;

/** Search strategy for the bot worker pool. */
export function xiangqiSearch(visible: XiangqiVisibleState, context: SearchContext): BotAction | null {
  const turn = xiangqiTurn(visible);
  if (!turn) return null;
  const move = xiangqiBestMove(turn.board, turn.side, turn.plies, {
    maxDepth: context.budget.maxDepth ?? 12, expired: context.budget.expired, random: context.random,
  });
  return move ? moveAction(move) : null;
}
