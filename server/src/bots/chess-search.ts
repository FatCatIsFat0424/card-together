// ─── Chess search: iterative-deepening alpha-beta with quiescence, MVV-LVA, killer, and history ordering ───
//
// Pure functions over the shared rules engine, so every move they return is one the server accepts. The hard bot
// runs them inside a bot worker with the pool's `SearchBudget`; the easy bot is a two-ply look with noise.

import {
  CHESS_BISHOP, CHESS_CELLS, CHESS_COL, CHESS_KING, CHESS_KNIGHT, CHESS_PAWN, CHESS_ROW,
  chessApply, chessDecode, chessEngine, chessFrom, chessGenerate, chessInCheckEngine,
  chessLegalEngineMoves, chessMake, chessNode, chessPositionKey, chessPromotionCode, chessTo, chessUnmake, chessVerdict,
} from '@shared/rules/chess';
import type { ChessEngine, ChessEngineBoard, ChessMove, ChessPosition, ChessSide } from '@shared/rules/chess';
import { chessHistoryOfLog } from '@shared/games/chess/log';
import type { ChessVisibleState } from '@shared/types';
import type { SearchContext, SearchBudget } from './search/search-types';
import type { BotAction } from './bot-decisions';

const MATE = 100_000;
/** Scores beyond this are mates found in the tree. */
const MATE_BOUND = MATE - 1_000;
/** Capture-only plies past the search horizon. */
const QUIESCENCE_PLIES = 8;
const MAX_PLY = 64;

// ─── Evaluation: material and piece-square tables, from the side to move's point of view ───

/** Centipawns by engine code; the king's worth is positional only. */
const MATERIAL = [0, 100, 320, 330, 500, 900, 0];
/** Weight of a piece in the game phase: 24 with every minor, rook, and queen on the board. */
const PHASE = [0, 0, 1, 1, 2, 4, 0];
const BISHOP_PAIR = 30;
const TEMPO = 8;

// Tables read like a diagram from white's side: the first row is rank 8. Black uses the mirrored square.
const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const KNIGHT_TABLE = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const ROOK_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const QUEEN_TABLE = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const KING_MIDDLE_TABLE = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const KING_END_TABLE = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];
/** Piece-square tables indexed by engine code (the king's is handled separately for the game phase). */
const TABLES: readonly (readonly number[])[] = [[], PAWN_TABLE, KNIGHT_TABLE, BISHOP_TABLE, ROOK_TABLE, QUEEN_TABLE, []];

/** The mirrored square: same file, opposite rank. */
const mirror = (square: number): number => square ^ 56;

/** Distance of a square from the board's centre, 0 (centre) to 6 (corner). */
const centreDistance = (square: number): number =>
  Math.max(3 - CHESS_COL[square], CHESS_COL[square] - 4) + Math.max(3 - CHESS_ROW[square], CHESS_ROW[square] - 4);

/**
 * Static score for the side to move. Dead material draws score zero; in a lopsided ending the leader is paid for
 * pushing the lone king to the edge and bringing its own king close, which is what makes mates reachable.
 */
function evaluate(board: ChessEngineBoard, side: ChessSide): number {
  let score = 0;
  let phase = 0;
  let material = 0;
  let pawns = 0;
  let heavy = 0;
  let minors = 0;
  const kings = [0, 0];
  const bishops = [0, 0];
  for (let square = 0; square < CHESS_CELLS; square++) {
    const piece = board[square];
    if (piece === 0) continue;
    const owner = piece > 0 ? 0 : 1;
    const sign = owner === 0 ? 1 : -1;
    const kind = Math.abs(piece);
    if (kind === CHESS_KING) {
      kings[owner] = square;
      continue;
    }
    if (kind === CHESS_PAWN) pawns++;
    else if (kind === CHESS_KNIGHT || kind === CHESS_BISHOP) minors++;
    else heavy++;
    if (kind === CHESS_BISHOP) bishops[owner]++;
    phase += PHASE[kind];
    if (kind !== CHESS_PAWN) material += sign * MATERIAL[kind];
    score += sign * (MATERIAL[kind] + TABLES[kind][owner === 0 ? square : mirror(square)]);
  }
  if (pawns === 0 && heavy === 0 && minors <= 1) return 0;
  phase = Math.min(phase, 24);
  const whiteKing = kings[0];
  const blackKing = mirror(kings[1]);
  score += Math.trunc((
    (KING_MIDDLE_TABLE[whiteKing] - KING_MIDDLE_TABLE[blackKing]) * phase
    + (KING_END_TABLE[whiteKing] - KING_END_TABLE[blackKing]) * (24 - phase)
  ) / 24);
  if (bishops[0] >= 2) score += BISHOP_PAIR;
  if (bishops[1] >= 2) score -= BISHOP_PAIR;
  if (phase <= 8 && Math.abs(material) >= 250) {
    const leader = material > 0 ? 0 : 1;
    const loser = kings[leader === 0 ? 1 : 0];
    const apart = Math.abs(CHESS_COL[kings[0]] - CHESS_COL[kings[1]]) + Math.abs(CHESS_ROW[kings[0]] - CHESS_ROW[kings[1]]);
    score += (leader === 0 ? 1 : -1) * (10 * centreDistance(loser) + 4 * (14 - apart));
  }
  return (side === 0 ? score : -score) + TEMPO;
}

/** Ordering weight of a piece as victim or attacker. */
const ORDER_VALUE = [0, 100, 320, 330, 500, 900, 20_000];

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

/** Two independent keys per signed piece code and square, combined into one safe integer. */
const ZOBRIST: { readonly low: Uint32Array; readonly high: Uint32Array; readonly side: readonly [number, number] } = (() => {
  const next = mulberry(0xc4e55_f00d);
  const low = new Uint32Array(13 * CHESS_CELLS).map(() => next());
  const high = new Uint32Array(13 * CHESS_CELLS).map(() => next() & 0x1fffff);
  return { low, high, side: [next(), next() & 0x1fffff] };
})();

/** Placement and side to move; castling rights and en passant are ignored, which only makes repeats likelier. */
function hashOf(board: ArrayLike<number>, side: ChessSide): number {
  let low = side === 1 ? ZOBRIST.side[0] : 0;
  let high = side === 1 ? ZOBRIST.side[1] : 0;
  for (let square = 0; square < CHESS_CELLS; square++) {
    const piece = board[square];
    if (piece === 0) continue;
    const key = (piece + 6) * CHESS_CELLS + square;
    low ^= ZOBRIST.low[key];
    high ^= ZOBRIST.high[key];
  }
  return (high >>> 0) * 0x1_0000_0000 + (low >>> 0);
}

const KEY_CODES: Readonly<Record<string, number>> = {
  P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: -1, n: -2, b: -3, r: -4, q: -5, k: -6,
};

/** Search hash of a `chessPositionKey`: its first 64 characters are the board and the next field the side. */
function hashOfKey(key: string): number {
  const board = Array.from({ length: CHESS_CELLS }, (_, square) => KEY_CODES[key[square]] ?? 0);
  return hashOf(board, key[65] === '1' ? 1 : 0);
}

// ─── Root classification ───

type RootKind = 'win' | 'draw' | 'open';

interface RootMove {
  readonly move: number;
  readonly kind: RootKind;
}

/** What the rules say right after `move`: an immediate win (checkmate), a draw by rule, or play on. */
function rootMoves(position: ChessPosition, history: readonly string[]): RootMove[] {
  const engine = chessEngine(position);
  const earlier = [...history, chessPositionKey(position)];
  return chessLegalEngineMoves(engine).map((move) => {
    const verdict = chessVerdict(chessApply(position, chessDecode(move)), earlier);
    return { move, kind: verdict === null ? 'open' : verdict.loser === null ? 'draw' : 'win' };
  });
}

// ─── Search ───

class Stop extends Error {}

export interface ChessSearchOptions {
  /** Deepest ply to search; the clock may end the search sooner. */
  readonly maxDepth: number;
  readonly budget: Pick<SearchBudget, 'expired'>;
  readonly random: () => number;
}

interface Searcher {
  readonly engine: ChessEngine;
  nodes: number;
  readonly path: number[];
  /** Hashes of positions before the root, which a line returning to them repeats. */
  readonly history: Set<number>;
  readonly killers: Int32Array;
  /** Quiet moves that caused cutoffs, by `from * 64 + to`. */
  readonly quiet: Int32Array;
  readonly expired: () => boolean;
}

/** Captures first by victim and attacker value, then promotions, killer moves, and the rest by history. */
function ordered(searcher: Searcher, moves: number[], ply: number): number[] {
  const { board } = searcher.engine;
  const killerA = searcher.killers[ply * 2];
  const killerB = searcher.killers[ply * 2 + 1];
  const keyed = moves.map((move) => {
    const attacker = Math.abs(board[chessFrom(move)]);
    let victim = Math.abs(board[chessTo(move)]);
    if (victim === 0 && attacker === CHESS_PAWN && CHESS_COL[chessFrom(move)] !== CHESS_COL[chessTo(move)]) victim = CHESS_PAWN;
    const promotion = chessPromotionCode(move);
    let key: number;
    if (victim !== 0) key = 2_000_000 + ORDER_VALUE[victim] * 16 - ORDER_VALUE[attacker] / 16 + (promotion ? ORDER_VALUE[promotion] : 0);
    else if (promotion !== 0) key = 1_900_000 + ORDER_VALUE[promotion];
    else if (move === killerA) key = 1_800_000;
    else if (move === killerB) key = 1_700_000;
    else key = Math.min(searcher.quiet[chessFrom(move) * 64 + chessTo(move)], 1_000_000);
    return { move, key };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((entry) => entry.move);
}

/** True for a move that neither captures (en passant included) nor promotes. */
function isQuiet(board: ChessEngineBoard, move: number): boolean {
  const from = chessFrom(move);
  const to = chessTo(move);
  if (board[to] !== 0 || chessPromotionCode(move) !== 0) return false;
  return !(Math.abs(board[from]) === CHESS_PAWN && CHESS_COL[from] !== CHESS_COL[to]);
}

function tick(searcher: Searcher): void {
  if ((++searcher.nodes & 1023) === 0 && searcher.expired()) throw new Stop();
}

function quiesce(searcher: Searcher, alpha: number, beta: number, ply: number, depth: number): number {
  tick(searcher);
  const { engine } = searcher;
  const stand = evaluate(engine.board, engine.turn);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (depth >= QUIESCENCE_PLIES || ply >= MAX_PLY) return stand;
  const side = engine.turn;
  const moves: number[] = [];
  chessGenerate(engine, moves, true);
  for (const move of ordered(searcher, moves, ply)) {
    const undo = chessMake(engine, move);
    if (chessInCheckEngine(engine, side)) {
      chessUnmake(engine, move, undo);
      continue;
    }
    const result = -quiesce(searcher, -beta, -alpha, ply + 1, depth + 1);
    chessUnmake(engine, move, undo);
    if (result >= beta) return result;
    if (result > alpha) alpha = result;
  }
  return alpha;
}

function negamax(searcher: Searcher, depth: number, alpha: number, beta: number, ply: number): number {
  tick(searcher);
  const { engine } = searcher;
  const key = hashOf(engine.board, engine.turn);
  // Returning to an earlier position of this line or of the game counts as a draw, as does the fifty-move rule.
  if (ply > 0 && (engine.halfmove >= 100 || searcher.history.has(key) || searcher.path.includes(key))) return 0;
  const side = engine.turn;
  const inCheck = chessInCheckEngine(engine, side);
  // Evasions are searched one ply deeper, so a check at the horizon is not mistaken for a quiet position.
  const remaining = inCheck && ply < MAX_PLY / 2 ? depth + 1 : depth;
  if (remaining <= 0) return quiesce(searcher, alpha, beta, ply, 0);
  const moves: number[] = [];
  chessGenerate(engine, moves);
  searcher.path.push(key);
  let best = -Infinity;
  let legal = 0;
  try {
    for (const move of ordered(searcher, moves, ply)) {
      const quietMove = isQuiet(engine.board, move);
      const undo = chessMake(engine, move);
      if (chessInCheckEngine(engine, side)) {
        chessUnmake(engine, move, undo);
        continue;
      }
      legal++;
      const result = -negamax(searcher, remaining - 1, -beta, -alpha, ply + 1);
      chessUnmake(engine, move, undo);
      if (result > best) best = result;
      if (result > alpha) alpha = result;
      if (alpha >= beta) {
        if (quietMove) {
          if (searcher.killers[ply * 2] !== move) {
            searcher.killers[ply * 2 + 1] = searcher.killers[ply * 2];
            searcher.killers[ply * 2] = move;
          }
          searcher.quiet[chessFrom(move) * 64 + chessTo(move)] += remaining * remaining;
        }
        break;
      }
    }
  } finally {
    searcher.path.pop();
  }
  // No legal move is checkmate or stalemate; sooner mates score further from zero.
  return legal === 0 ? (inCheck ? -MATE + ply : 0) : best;
}

/**
 * Iterative deepening from one ply: the best move of the deepest finished iteration wins (or of a partly finished
 * one, once its first move is done), and equally scored moves are chosen between at random. A move that mates on
 * the spot is played at once; draws by the rules score zero. `history` holds the keys of the positions before
 * `position`. Returns null without a legal move or when `side` is not the one to move.
 */
export function chessBestMove(
  position: ChessPosition, side: ChessSide, history: readonly string[], options: ChessSearchOptions,
): ChessMove | null {
  if (side !== position.turn) return null;
  const roots = rootMoves(position, history);
  if (roots.length === 0) return null;
  const win = roots.find((entry) => entry.kind === 'win');
  if (win) return chessDecode(win.move);
  if (roots.length === 1) return chessDecode(roots[0].move);

  const engine = chessEngine(position);
  const searcher: Searcher = {
    engine, nodes: 0, path: [], history: new Set([...history.map(hashOfKey), hashOf(engine.board, side)]),
    killers: new Int32Array(MAX_PLY * 2 + 4), quiet: new Int32Array(64 * 64), expired: options.budget.expired,
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
          const undo = chessMake(engine, move);
          try {
            // A window one below the best keeps equal scores exact, so ties can be chosen at random.
            result = -negamax(searcher, depth - 1, -Infinity, -(alpha - 1), 1);
          } finally {
            chessUnmake(engine, move, undo);
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
    if (stopped || options.budget.expired() || Math.abs(ranked[0].score) >= MATE_BOUND) break;
  }
  return chessDecode(best);
}

/** Noise added to Easy's two-ply scores: about one and a half pawns. */
const EASY_NOISE = 150;

/**
 * Easy: each move is scored by the opponent's best static reply (two plies, no quiescence), plus noise, so it
 * avoids leaving pieces hanging to a single capture but misses deeper tactics. It still takes a mate in one and
 * does not walk into a draw by the rules while a better move exists.
 */
export function chessEasyMove(
  position: ChessPosition, side: ChessSide, history: readonly string[], random: () => number,
): ChessMove | null {
  if (side !== position.turn) return null;
  const roots = rootMoves(position, history);
  if (roots.length === 0) return null;
  const win = roots.find((entry) => entry.kind === 'win');
  if (win) return chessDecode(win.move);
  const engine = chessEngine(position);
  let best: { move: number; score: number } | null = null;
  for (const { move, kind } of roots) {
    let score = 0;
    if (kind !== 'draw') {
      const undo = chessMake(engine, move);
      const replies = chessLegalEngineMoves(engine);
      if (replies.length === 0) {
        score = chessInCheckEngine(engine, engine.turn) ? MATE : 0;
      } else {
        let reply = Infinity;
        for (const answer of replies) {
          const taken = chessMake(engine, answer);
          // After the reply it is this side's turn again, so the evaluation is already from its point of view.
          reply = Math.min(reply, evaluate(engine.board, engine.turn));
          chessUnmake(engine, answer, taken);
        }
        score = reply;
      }
      chessUnmake(engine, move, undo);
    }
    score += random() * EASY_NOISE;
    if (!best || score > best.score) best = { move, score };
  }
  return best ? chessDecode(best.move) : null;
}

// ─── Bot actions from a view ───

/** The viewer's side, position, and earlier position keys when it is their turn in a running match, otherwise null. */
export function chessTurn(visible: ChessVisibleState): { side: ChessSide; position: ChessPosition; history: string[] } | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat) return null;
  const side: ChessSide = index === 0 ? 0 : 1;
  const position: ChessPosition = {
    board: visible.board, turn: side, castling: visible.castling, enPassant: visible.enPassant, halfmove: visible.halfmove,
  };
  return { side, position, history: chessHistoryOfLog(visible.log) };
}

export function moveAction(move: ChessMove): BotAction {
  return {
    type: 'game-action',
    request: {
      gameType: 'chess',
      action: { type: 'move', from: chessNode(move.from), to: chessNode(move.to), ...move.promotion ? { promotion: move.promotion } : {} },
    },
  };
}

/** Plies the synchronous hard move searches, within `QUICK_BUDGET_MS`. */
export const QUICK_DEPTH = 3;
export const QUICK_BUDGET_MS = 150;

/** Search strategy for the bot worker pool. */
export function chessSearch(visible: ChessVisibleState, context: SearchContext): BotAction | null {
  const turn = chessTurn(visible);
  if (!turn) return null;
  const move = chessBestMove(turn.position, turn.side, turn.history, {
    maxDepth: context.budget.maxDepth ?? 12, budget: context.budget, random: context.random,
  });
  return move ? moveAction(move) : null;
}
