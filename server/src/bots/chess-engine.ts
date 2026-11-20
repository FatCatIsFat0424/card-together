// ─── Chess search board: incremental make/unmake, Zobrist hashing, move generation, attacks, and SEE ───
//
// A mutable mailbox for the bot's search, kept separate from the shared rules engine so it can carry the hash,
// piece counts, and undo stacks the search needs without allocating. Squares and engine codes match
// `@shared/rules/chess` (row 0 is rank 8, white positive) and moves use the same packing (`chessEncode`), so a
// move decoded with `chessDecode` is one the rules accept. Perft tests compare it with the shared generator.

import * as chessRules from '@shared/rules/chess';
import type { ChessPosition, ChessSide } from '@shared/rules/chess';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const { CHESS_BISHOP, CHESS_KING, CHESS_KNIGHT, CHESS_PAWN, CHESS_QUEEN, CHESS_ROOK, chessEngineBoard } = chessRules;

/** Deepest search ply; the undo stacks hold this many moves past the game history. */
export const CHESS_MAX_PLY = 128;
/** Game positions kept for repetition checks; older ones cannot repeat after 100 reversible plies anyway. */
const HISTORY_SLOTS = 256;

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

/** Rights lost when a move starts from or lands on the square. */
const CASTLE_LOSS: Uint8Array = (() => {
  const table = new Uint8Array(64);
  table[60] = CASTLE_WK | CASTLE_WQ;
  table[63] = CASTLE_WK;
  table[56] = CASTLE_WQ;
  table[4] = CASTLE_BK | CASTLE_BQ;
  table[7] = CASTLE_BK;
  table[0] = CASTLE_BQ;
  return table;
})();

// ─── Geometry tables ───

function jumps(offsets: readonly (readonly [number, number])[]): { list: Int8Array; count: Uint8Array } {
  const list = new Int8Array(64 * 8);
  const count = new Uint8Array(64);
  for (let square = 0; square < 64; square++) {
    for (const [dc, dr] of offsets) {
      const col = (square & 7) + dc;
      const row = (square >> 3) + dr;
      if (col >= 0 && col < 8 && row >= 0 && row < 8) list[square * 8 + count[square]++] = row * 8 + col;
    }
  }
  return { list, count };
}

export const KNIGHT_STEPS = jumps([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
export const KING_STEPS = jumps([[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]);

/** Directions as [dc, dr]: 0–3 straight, 4–7 diagonal. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
];
/** `RAY[(square * 8 + direction) * 8 + i]` walks away from the square; `RAY_LENGTH[square * 8 + direction]` squares. */
export const RAY = new Int8Array(64 * 8 * 8);
export const RAY_LENGTH = new Uint8Array(64 * 8);
for (let square = 0; square < 64; square++) {
  DIRECTIONS.forEach(([dc, dr], direction) => {
    let col = (square & 7) + dc;
    let row = (square >> 3) + dr;
    let length = 0;
    while (col >= 0 && col < 8 && row >= 0 && row < 8) {
      RAY[(square * 8 + direction) * 8 + length++] = row * 8 + col;
      col += dc;
      row += dr;
    }
    RAY_LENGTH[square * 8 + direction] = length;
  });
}

// ─── Zobrist keys ───

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const keyStream = mulberry(0xc4e55_f00d);
/** Indexed `(code + 6) * 64 + square`. */
const Z_PIECE_LO = Int32Array.from({ length: 13 * 64 }, keyStream);
const Z_PIECE_HI = Int32Array.from({ length: 13 * 64 }, keyStream);
const Z_SIDE_LO = keyStream();
const Z_SIDE_HI = keyStream();
const Z_CASTLE_LO = Int32Array.from({ length: 16 }, keyStream);
const Z_CASTLE_HI = Int32Array.from({ length: 16 }, keyStream);
const Z_EP_LO = Int32Array.from({ length: 8 }, keyStream);
const Z_EP_HI = Int32Array.from({ length: 8 }, keyStream);

// ─── State ───

export interface ChessBoardState {
  /** Engine codes per square: white 1–6, black −1…−6. */
  readonly squares: Int8Array;
  side: ChessSide;
  castling: number;
  /** En-passant target square, −1 when absent; only set when an enemy pawn stands ready to take. */
  enPassant: number;
  halfmove: number;
  /** King square per side. */
  readonly kings: Int32Array;
  hashLow: number;
  hashHigh: number;
  /** Piece counts by `code + 6`. */
  readonly counts: Int32Array;
  /** Moves made since the root of the search (the undo stack depth). */
  ply: number;
  readonly undoCaptured: Int8Array;
  readonly undoCastling: Uint8Array;
  readonly undoEnPassant: Int8Array;
  readonly undoHalfmove: Int32Array;
  readonly undoLow: Int32Array;
  readonly undoHigh: Int32Array;
  /** Hashes of the game's earlier positions and of the search line, oldest first. */
  readonly historyLow: Int32Array;
  readonly historyHigh: Int32Array;
  historyLength: number;
  /** `historyLength` at the root: entries before it are game history. */
  rootHistory: number;
}

/** True when a pawn of `side` stands beside the square a double push of the other side skipped over. */
function enPassantReady(squares: Int8Array, target: number, side: ChessSide): boolean {
  // The capturing pawn stands on the pushed pawn's rank: one row past the target, seen from the capturer.
  const landing = target + (side === 0 ? 8 : -8);
  const pawn = side === 0 ? CHESS_PAWN : -CHESS_PAWN;
  const col = landing & 7;
  return (col > 0 && squares[landing - 1] === pawn) || (col < 7 && squares[landing + 1] === pawn);
}

/** Recomputes the Zobrist key of the state's position from scratch. */
export function chessHashOf(
  squares: Int8Array, side: ChessSide, castling: number, enPassant: number,
): { low: number; high: number } {
  let low = side === 1 ? Z_SIDE_LO : 0;
  let high = side === 1 ? Z_SIDE_HI : 0;
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    low ^= Z_PIECE_LO[(piece + 6) * 64 + square];
    high ^= Z_PIECE_HI[(piece + 6) * 64 + square];
  }
  low ^= Z_CASTLE_LO[castling];
  high ^= Z_CASTLE_HI[castling];
  if (enPassant >= 0) {
    low ^= Z_EP_LO[enPassant & 7];
    high ^= Z_EP_HI[enPassant & 7];
  }
  return { low, high };
}

const castlingMaskOf = (castling: ChessPosition['castling']): number =>
  (castling.K ? CASTLE_WK : 0) | (castling.Q ? CASTLE_WQ : 0) | (castling.k ? CASTLE_BK : 0) | (castling.q ? CASTLE_BQ : 0);

export function chessBoardState(position: ChessPosition): ChessBoardState {
  const squares = chessEngineBoard(position.board);
  const counts = new Int32Array(13);
  const kings = new Int32Array([-1, -1]);
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    counts[piece + 6]++;
    if (piece === CHESS_KING) kings[0] = square;
    else if (piece === -CHESS_KING) kings[1] = square;
  }
  const castling = castlingMaskOf(position.castling);
  const enPassant = position.enPassant !== null && enPassantReady(squares, position.enPassant, position.turn)
    ? position.enPassant : -1;
  const { low, high } = chessHashOf(squares, position.turn, castling, enPassant);
  return {
    squares, side: position.turn, castling, enPassant, halfmove: position.halfmove, kings, hashLow: low, hashHigh: high,
    counts, ply: 0,
    undoCaptured: new Int8Array(CHESS_MAX_PLY + 8), undoCastling: new Uint8Array(CHESS_MAX_PLY + 8),
    undoEnPassant: new Int8Array(CHESS_MAX_PLY + 8), undoHalfmove: new Int32Array(CHESS_MAX_PLY + 8),
    undoLow: new Int32Array(CHESS_MAX_PLY + 8), undoHigh: new Int32Array(CHESS_MAX_PLY + 8),
    historyLow: new Int32Array(HISTORY_SLOTS + CHESS_MAX_PLY + 8),
    historyHigh: new Int32Array(HISTORY_SLOTS + CHESS_MAX_PLY + 8), historyLength: 0, rootHistory: 0,
  };
}

const KEY_CODES: Readonly<Record<string, number>> = {
  P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, p: -1, n: -2, b: -3, r: -4, q: -5, k: -6,
};

/**
 * Hash of a `chessPositionKey` (board, side, castling rights, and an en-passant square only when a capture there
 * is legal), comparable with the search's own keys.
 */
export function chessHashOfKey(key: string): { low: number; high: number } {
  const squares = new Int8Array(64);
  for (let square = 0; square < 64; square++) squares[square] = KEY_CODES[key[square]] ?? 0;
  const [, side, rights = '-', target = '-'] = key.slice(64).split(' ');
  const castling = (rights.includes('K') ? CASTLE_WK : 0) | (rights.includes('Q') ? CASTLE_WQ : 0)
    | (rights.includes('k') ? CASTLE_BK : 0) | (rights.includes('q') ? CASTLE_BQ : 0);
  const enPassant = target === '-' ? -1 : (8 - Number(target[1])) * 8 + (target.charCodeAt(0) - 97);
  return chessHashOf(squares, side === '1' ? 1 : 0, castling, enPassant);
}

/** Loads the game's earlier position keys, newest last, for repetition checks in the search. */
export function chessSetHistory(state: ChessBoardState, keys: readonly string[]): void {
  const recent = keys.slice(-Math.min(HISTORY_SLOTS, state.halfmove));
  recent.forEach((key, index) => {
    const { low, high } = chessHashOfKey(key);
    state.historyLow[index] = low;
    state.historyHigh[index] = high;
  });
  state.historyLength = recent.length;
  state.rootHistory = recent.length;
}

// ─── Attacks ───

/** True when a piece of `by` attacks `square` on `squares` (pins ignored). */
export function chessAttackedBy(squares: Int8Array, square: number, by: ChessSide): boolean {
  const sign = by === 0 ? 1 : -1;
  const col = square & 7;
  // White pawns attack towards row 0, so an attacking white pawn stands one row below the target.
  const pawnSquare = square + (by === 0 ? 8 : -8);
  if (pawnSquare >= 0 && pawnSquare < 64) {
    const pawn = sign * CHESS_PAWN;
    if (col > 0 && squares[pawnSquare - 1] === pawn) return true;
    if (col < 7 && squares[pawnSquare + 1] === pawn) return true;
  }
  const knight = sign * CHESS_KNIGHT;
  for (let index = square * 8, end = index + KNIGHT_STEPS.count[square]; index < end; index++) {
    if (squares[KNIGHT_STEPS.list[index]] === knight) return true;
  }
  const king = sign * CHESS_KING;
  for (let index = square * 8, end = index + KING_STEPS.count[square]; index < end; index++) {
    if (squares[KING_STEPS.list[index]] === king) return true;
  }
  const queen = sign * CHESS_QUEEN;
  for (let direction = 0; direction < 8; direction++) {
    const slider = sign * (direction < 4 ? CHESS_ROOK : CHESS_BISHOP);
    const base = (square * 8 + direction) * 8;
    for (let step = 0, length = RAY_LENGTH[square * 8 + direction]; step < length; step++) {
      const piece = squares[RAY[base + step]];
      if (piece === 0) continue;
      if (piece === slider || piece === queen) return true;
      break;
    }
  }
  return false;
}

export const chessStateInCheck = (state: ChessBoardState, side: ChessSide): boolean =>
  chessAttackedBy(state.squares, state.kings[side], side === 0 ? 1 : 0);

// ─── Move generation ───

const encode = (from: number, to: number, promotion = 0): number => from | (to << 6) | (promotion << 12);

/**
 * Appends the side to move's pseudo-legal moves to `out` from `start`; returns the new end. With `noisyOnly`,
 * only captures (en passant included) and queen promotions.
 */
export function chessGenerateMoves(state: ChessBoardState, out: Int32Array, start: number, noisyOnly: boolean): number {
  const { squares } = state;
  const side = state.side;
  const sign = side === 0 ? 1 : -1;
  const forward = side === 0 ? -8 : 8;
  const startRow = side === 0 ? 6 : 1;
  const lastRow = side === 0 ? 0 : 7;
  let end = start;
  for (let from = 0; from < 64; from++) {
    const piece = squares[from] * sign;
    if (piece <= 0) continue;
    if (piece === CHESS_PAWN) {
      const col = from & 7;
      const one = from + forward;
      const promotes = one >> 3 === lastRow;
      for (let dc = -1; dc <= 1; dc += 2) {
        if (col + dc < 0 || col + dc > 7) continue;
        const to = one + dc;
        if (squares[to] * sign < 0) {
          if (promotes) {
            out[end++] = encode(from, to, CHESS_QUEEN);
            if (!noisyOnly) {
              out[end++] = encode(from, to, CHESS_KNIGHT);
              out[end++] = encode(from, to, CHESS_ROOK);
              out[end++] = encode(from, to, CHESS_BISHOP);
            }
          } else {
            out[end++] = encode(from, to);
          }
        } else if (to === state.enPassant && squares[to] === 0) {
          out[end++] = encode(from, to);
        }
      }
      if (squares[one] === 0) {
        if (promotes) {
          out[end++] = encode(from, one, CHESS_QUEEN);
          if (!noisyOnly) {
            out[end++] = encode(from, one, CHESS_KNIGHT);
            out[end++] = encode(from, one, CHESS_ROOK);
            out[end++] = encode(from, one, CHESS_BISHOP);
          }
        } else if (!noisyOnly) {
          out[end++] = encode(from, one);
          if (from >> 3 === startRow && squares[one + forward] === 0) out[end++] = encode(from, one + forward);
        }
      }
    } else if (piece === CHESS_KNIGHT || piece === CHESS_KING) {
      const steps = piece === CHESS_KNIGHT ? KNIGHT_STEPS : KING_STEPS;
      for (let index = from * 8, last = index + steps.count[from]; index < last; index++) {
        const to = steps.list[index];
        const target = squares[to] * sign;
        if (target > 0 || (noisyOnly && target === 0)) continue;
        out[end++] = encode(from, to);
      }
      if (piece === CHESS_KING && !noisyOnly) end = generateCastles(state, from, out, end);
    } else {
      const first = piece === CHESS_BISHOP ? 4 : 0;
      const last = piece === CHESS_ROOK ? 4 : 8;
      for (let direction = first; direction < last; direction++) {
        const base = (from * 8 + direction) * 8;
        for (let step = 0, length = RAY_LENGTH[from * 8 + direction]; step < length; step++) {
          const to = RAY[base + step];
          const target = squares[to] * sign;
          if (target > 0) break;
          if (target < 0) {
            out[end++] = encode(from, to);
            break;
          }
          if (!noisyOnly) out[end++] = encode(from, to);
        }
      }
    }
  }
  return end;
}

function generateCastles(state: ChessBoardState, from: number, out: Int32Array, end: number): number {
  const side = state.side;
  const home = side === 0 ? 60 : 4;
  const kingside = side === 0 ? CASTLE_WK : CASTLE_BK;
  const queenside = side === 0 ? CASTLE_WQ : CASTLE_BQ;
  if (from !== home || (state.castling & (kingside | queenside)) === 0) return end;
  const { squares } = state;
  const foe: ChessSide = side === 0 ? 1 : 0;
  const rook = (side === 0 ? 1 : -1) * CHESS_ROOK;
  if (chessAttackedBy(squares, home, foe)) return end;
  if ((state.castling & kingside) !== 0 && squares[home + 3] === rook && squares[home + 1] === 0 && squares[home + 2] === 0
    && !chessAttackedBy(squares, home + 1, foe)) {
    out[end++] = encode(home, home + 2);
  }
  if ((state.castling & queenside) !== 0 && squares[home - 4] === rook && squares[home - 1] === 0
    && squares[home - 2] === 0 && squares[home - 3] === 0 && !chessAttackedBy(squares, home - 1, foe)) {
    out[end++] = encode(home, home - 2);
  }
  return end;
}

// ─── Make and unmake ───

function toggle(state: ChessBoardState, piece: number, square: number): void {
  state.hashLow ^= Z_PIECE_LO[(piece + 6) * 64 + square];
  state.hashHigh ^= Z_PIECE_HI[(piece + 6) * 64 + square];
}

function pushUndo(state: ChessBoardState, captured: number): void {
  const ply = state.ply;
  state.undoCaptured[ply] = captured;
  state.undoCastling[ply] = state.castling;
  state.undoEnPassant[ply] = state.enPassant;
  state.undoHalfmove[ply] = state.halfmove;
  state.undoLow[ply] = state.hashLow;
  state.undoHigh[ply] = state.hashHigh;
  state.historyLow[state.historyLength] = state.hashLow;
  state.historyHigh[state.historyLength] = state.hashHigh;
  state.historyLength++;
  state.ply = ply + 1;
}

/** Plays a pseudo-legal move in place; `chessUnmakeMove` takes it back. The mover's king may be left attacked. */
export function chessMakeMove(state: ChessBoardState, move: number): void {
  const { squares } = state;
  const from = move & 63;
  const to = (move >> 6) & 63;
  const promotion = (move >> 12) & 7;
  const piece = squares[from];
  const captured = squares[to];
  const side = state.side;
  pushUndo(state, captured);
  if (state.enPassant >= 0) {
    state.hashLow ^= Z_EP_LO[state.enPassant & 7];
    state.hashHigh ^= Z_EP_HI[state.enPassant & 7];
  }
  state.enPassant = -1;
  state.halfmove++;
  toggle(state, piece, from);
  squares[from] = 0;
  if (captured !== 0) {
    toggle(state, captured, to);
    state.counts[captured + 6]--;
    state.halfmove = 0;
  }
  let placed = piece;
  const kind = piece > 0 ? piece : -piece;
  if (kind === CHESS_PAWN) {
    state.halfmove = 0;
    if (captured === 0 && (from & 7) !== (to & 7)) {
      const taken = to + (side === 0 ? 8 : -8);
      toggle(state, squares[taken], taken);
      state.counts[squares[taken] + 6]--;
      squares[taken] = 0;
    } else if (to - from === 16 || from - to === 16) {
      const target = (from + to) >> 1;
      if (enPassantReady(squares, target, side === 0 ? 1 : 0)) {
        state.enPassant = target;
        state.hashLow ^= Z_EP_LO[target & 7];
        state.hashHigh ^= Z_EP_HI[target & 7];
      }
    }
    if (promotion !== 0) {
      placed = side === 0 ? promotion : -promotion;
      state.counts[piece + 6]--;
      state.counts[placed + 6]++;
    }
  } else if (kind === CHESS_KING) {
    state.kings[side] = to;
    if (to - from === 2 || from - to === 2) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      const rook = squares[rookFrom];
      toggle(state, rook, rookFrom);
      toggle(state, rook, rookTo);
      squares[rookTo] = rook;
      squares[rookFrom] = 0;
    }
  }
  squares[to] = placed;
  toggle(state, placed, to);
  const castling = state.castling & ~(CASTLE_LOSS[from] | CASTLE_LOSS[to]);
  if (castling !== state.castling) {
    state.hashLow ^= Z_CASTLE_LO[state.castling] ^ Z_CASTLE_LO[castling];
    state.hashHigh ^= Z_CASTLE_HI[state.castling] ^ Z_CASTLE_HI[castling];
    state.castling = castling;
  }
  state.side = side === 0 ? 1 : 0;
  state.hashLow ^= Z_SIDE_LO;
  state.hashHigh ^= Z_SIDE_HI;
}

export function chessUnmakeMove(state: ChessBoardState, move: number): void {
  const { squares } = state;
  const ply = --state.ply;
  state.historyLength--;
  const from = move & 63;
  const to = (move >> 6) & 63;
  const side: ChessSide = state.side === 0 ? 1 : 0;
  const captured = state.undoCaptured[ply];
  const placed = squares[to];
  const moved = ((move >> 12) & 7) !== 0 ? (side === 0 ? CHESS_PAWN : -CHESS_PAWN) : placed;
  if (moved !== placed) {
    state.counts[placed + 6]--;
    state.counts[moved + 6]++;
  }
  squares[from] = moved;
  squares[to] = captured;
  if (captured !== 0) state.counts[captured + 6]++;
  const kind = moved > 0 ? moved : -moved;
  if (kind === CHESS_PAWN) {
    if (captured === 0 && (from & 7) !== (to & 7)) {
      const pawn = side === 0 ? -CHESS_PAWN : CHESS_PAWN;
      squares[to + (side === 0 ? 8 : -8)] = pawn;
      state.counts[pawn + 6]++;
    }
  } else if (kind === CHESS_KING) {
    state.kings[side] = from;
    if (to - from === 2 || from - to === 2) {
      const rookFrom = to > from ? from + 3 : from - 4;
      const rookTo = to > from ? from + 1 : from - 1;
      squares[rookFrom] = squares[rookTo];
      squares[rookTo] = 0;
    }
  }
  state.side = side;
  state.castling = state.undoCastling[ply];
  state.enPassant = state.undoEnPassant[ply];
  state.halfmove = state.undoHalfmove[ply];
  state.hashLow = state.undoLow[ply];
  state.hashHigh = state.undoHigh[ply];
}

/** Passes the turn (for null-move pruning); repetition scans stop at it. */
export function chessMakeNull(state: ChessBoardState): void {
  pushUndo(state, 0);
  if (state.enPassant >= 0) {
    state.hashLow ^= Z_EP_LO[state.enPassant & 7];
    state.hashHigh ^= Z_EP_HI[state.enPassant & 7];
    state.enPassant = -1;
  }
  state.halfmove = 0;
  state.side = state.side === 0 ? 1 : 0;
  state.hashLow ^= Z_SIDE_LO;
  state.hashHigh ^= Z_SIDE_HI;
}

export function chessUnmakeNull(state: ChessBoardState): void {
  const ply = --state.ply;
  state.historyLength--;
  state.side = state.side === 0 ? 1 : 0;
  state.enPassant = state.undoEnPassant[ply];
  state.halfmove = state.undoHalfmove[ply];
  state.hashLow = state.undoLow[ply];
  state.hashHigh = state.undoHigh[ply];
}

/**
 * How the current position repeats: 2 when it also occurred inside the search line (or twice before the root),
 * so the game can be drawn by repetition from here; 1 when it occurred once before the root; 0 otherwise.
 */
export function chessRepetition(state: ChessBoardState): number {
  const low = state.hashLow;
  const high = state.hashHigh;
  const oldest = Math.max(0, state.historyLength - state.halfmove);
  let earlier = 0;
  for (let index = state.historyLength - 2; index >= oldest; index -= 2) {
    if (state.historyLow[index] !== low || state.historyHigh[index] !== high) continue;
    if (index >= state.rootHistory) return 2;
    earlier++;
  }
  return earlier >= 2 ? 2 : earlier;
}

// ─── Static exchange evaluation ───

/** Exchange values by piece kind (the king is large so it is never "won"). */
export const SEE_VALUE = [0, 100, 320, 330, 500, 950, 10_000];

/** Square of the least valuable piece of `side` attacking `square`, or −1. */
function leastAttacker(squares: Int8Array, square: number, side: ChessSide): number {
  const sign = side === 0 ? 1 : -1;
  const col = square & 7;
  const pawnSquare = square + (side === 0 ? 8 : -8);
  if (pawnSquare >= 0 && pawnSquare < 64) {
    if (col > 0 && squares[pawnSquare - 1] === sign * CHESS_PAWN) return pawnSquare - 1;
    if (col < 7 && squares[pawnSquare + 1] === sign * CHESS_PAWN) return pawnSquare + 1;
  }
  for (let index = square * 8, end = index + KNIGHT_STEPS.count[square]; index < end; index++) {
    if (squares[KNIGHT_STEPS.list[index]] === sign * CHESS_KNIGHT) return KNIGHT_STEPS.list[index];
  }
  let bishop = -1;
  let rook = -1;
  let queen = -1;
  for (let direction = 0; direction < 8; direction++) {
    const base = (square * 8 + direction) * 8;
    for (let step = 0, length = RAY_LENGTH[square * 8 + direction]; step < length; step++) {
      const at = RAY[base + step];
      const piece = squares[at] * sign;
      if (piece === 0) continue;
      if (piece === CHESS_QUEEN) queen = at;
      else if (piece === CHESS_BISHOP && direction >= 4) bishop = at;
      else if (piece === CHESS_ROOK && direction < 4) rook = at;
      break;
    }
  }
  if (bishop >= 0) return bishop;
  if (rook >= 0) return rook;
  if (queen >= 0) return queen;
  for (let index = square * 8, end = index + KING_STEPS.count[square]; index < end; index++) {
    if (squares[KING_STEPS.list[index]] === sign * CHESS_KING) return KING_STEPS.list[index];
  }
  return -1;
}

const swapGain = new Int32Array(40);
const swapSquares = new Int8Array(40);
const swapPieces = new Int8Array(40);

/**
 * Material the side to move expects from `move` when both sides keep recapturing on its target with their least
 * valuable piece and may stop at any point. Removed pieces open x-rays naturally; the board is restored.
 */
export function chessSee(state: ChessBoardState, move: number): number {
  const { squares } = state;
  const from = move & 63;
  const to = (move >> 6) & 63;
  const promotion = (move >> 12) & 7;
  const mover = squares[from];
  const victim = squares[to];
  let gain = victim !== 0 ? SEE_VALUE[victim > 0 ? victim : -victim] : 0;
  let removed = 0;
  // En passant: the taken pawn stands behind the target.
  if (victim === 0 && (mover === CHESS_PAWN || mover === -CHESS_PAWN) && (from & 7) !== (to & 7)) {
    const taken = to + (mover > 0 ? 8 : -8);
    gain = SEE_VALUE[CHESS_PAWN];
    swapSquares[removed] = taken;
    swapPieces[removed++] = squares[taken];
    squares[taken] = 0;
  }
  let onSquare = promotion !== 0 ? SEE_VALUE[promotion] : SEE_VALUE[mover > 0 ? mover : -mover];
  if (promotion !== 0) gain += SEE_VALUE[promotion] - SEE_VALUE[CHESS_PAWN];
  swapGain[0] = gain;
  swapSquares[removed] = from;
  swapPieces[removed++] = mover;
  squares[from] = 0;
  const savedTarget = squares[to];
  squares[to] = mover;
  let side: ChessSide = mover > 0 ? 1 : 0;
  let depth = 1;
  for (; depth < 32; depth++) {
    const attacker = leastAttacker(squares, to, side);
    if (attacker < 0) break;
    const piece = squares[attacker];
    // A king may only take last: if the other side still attacks the square, the capture is illegal.
    if (piece === CHESS_KING || piece === -CHESS_KING) {
      squares[attacker] = 0;
      const defended = leastAttacker(squares, to, side === 0 ? 1 : 0) >= 0;
      squares[attacker] = piece;
      if (defended) break;
    }
    swapGain[depth] = onSquare - swapGain[depth - 1];
    onSquare = SEE_VALUE[piece > 0 ? piece : -piece];
    swapSquares[removed] = attacker;
    swapPieces[removed++] = piece;
    squares[attacker] = 0;
    squares[to] = piece;
    side = side === 0 ? 1 : 0;
  }
  while (--depth > 0) swapGain[depth - 1] = -Math.max(-swapGain[depth - 1], swapGain[depth]);
  squares[to] = savedTarget;
  for (let index = removed - 1; index >= 0; index--) squares[swapSquares[index]] = swapPieces[index];
  return swapGain[0];
}
