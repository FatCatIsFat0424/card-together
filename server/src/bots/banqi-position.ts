// ─── Banqi search position: a mutable board with an incremental Zobrist hash and an allocation-free move generator ───
//
// The searcher's picture of a position: the public cells, the pieces nobody has seen yet (the pool), and the
// no-capture counter. Move generation mirrors `bqMovesFrom` in the shared rules (tests compare the two), but writes
// packed integers into a caller buffer so a search node allocates nothing.

import {
  BQ_CANNON, BQ_CELLS, BQ_CHARIOT, BQ_DOWN, BQ_EMPTY, BQ_PIECE_COUNT, bqBlindTakes, bqCanCapture, bqColour, bqRank,
} from '@shared/rules/banqi';
import type { BqRules } from '@shared/rules/banqi';

export const CELLS = BQ_CELLS;
export const EMPTY = BQ_EMPTY;
export const DOWN = BQ_DOWN;

/** Packed move kinds. A flip has `from === to`; a stop passes the turn inside a capture chain. */
export const QUIET = 0;
export const CAPTURE = 1;
export const BLIND = 2;
export const FLIP = 3;
export const STOP = 4;

export const packMove = (from: number, to: number, kind: number): number => from | (to << 5) | (kind << 10);
export const moveFrom = (move: number): number => move & 31;
export const moveTo = (move: number): number => (move >> 5) & 31;
export const moveKind = (move: number): number => move >> 10;

export const COLOUR = Int8Array.from({ length: BQ_PIECE_COUNT }, (_, piece) => bqColour(piece));
export const RANK = Int8Array.from({ length: BQ_PIECE_COUNT }, (_, piece) => bqRank(piece));
/** `CAN_CAPTURE[attacker * 14 + target]`: whether a move onto the target takes it (never the cannon). */
export const CAN_CAPTURE = Uint8Array.from({ length: BQ_PIECE_COUNT * BQ_PIECE_COUNT }, (_, index) =>
  (bqCanCapture(Math.floor(index / BQ_PIECE_COUNT), index % BQ_PIECE_COUNT) ? 1 : 0));
/** `BLIND_TAKES[attacker * 14 + revealed]`: whether a blind attack takes the piece it turns over. */
export const BLIND_TAKES = Uint8Array.from({ length: BQ_PIECE_COUNT * BQ_PIECE_COUNT }, (_, index) =>
  (bqBlindTakes(Math.floor(index / BQ_PIECE_COUNT), index % BQ_PIECE_COUNT) ? 1 : 0));

/** Cells along each direction from a cell, nearest first; directions are up, right, down, left as in the shared rules. */
const RAYS: readonly Int8Array[] = (() => {
  const steps: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const rays: Int8Array[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    for (const [dc, dr] of steps) {
      const line: number[] = [];
      let col = (cell % 8) + dc;
      let row = Math.floor(cell / 8) + dr;
      while (col >= 0 && col < 8 && row >= 0 && row < 4) {
        line.push(row * 8 + col);
        col += dc;
        row += dr;
      }
      rays.push(Int8Array.from(line));
    }
  }
  return rays;
})();

export const rayOf = (cell: number, direction: number): Int8Array => RAYS[cell * 4 + direction];

/** Manhattan distance between two cells. */
export const DISTANCE = Int8Array.from({ length: CELLS * CELLS }, (_, index) => {
  const a = Math.floor(index / CELLS);
  const b = index % CELLS;
  return Math.abs((a % 8) - (b % 8)) + Math.abs(Math.floor(a / 8) - Math.floor(b / 8));
});

// ─── Zobrist keys ───

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const keys = (() => {
  const next = mulberry(0x62a9_71c3);
  const table = (size: number): Int32Array => Int32Array.from({ length: size }, () => next());
  return {
    cell0: table(CELLS * 16), cell1: table(CELLS * 16),
    pool0: table(BQ_PIECE_COUNT * 8), pool1: table(BQ_PIECE_COUNT * 8),
    side0: table(2), side1: table(2),
    chain0: table(CELLS + 1), chain1: table(CELLS + 1),
    quiet0: table(64), quiet1: table(64),
  };
})();

/** From this count the no-capture counter is part of a position's identity: the evaluation fades with it. */
export const QUIET_KEY_FROM = 12;
export const QUIET_LIMIT = 50;

export interface Position {
  /** Cell contents: a piece 0–13, `EMPTY`, or `DOWN`. */
  readonly board: Int8Array;
  /** Pieces nobody has seen, by type: what the face-down cells may hide. */
  readonly pool: Int8Array;
  /** Pieces of each colour still in the game, face up or not. */
  readonly alive: Int32Array;
  /** Face-down cells; always the sum of the pool. */
  down: number;
  /** Consecutive turns without a flip or a capture. */
  quiet: number;
  h0: number;
  h1: number;
  readonly chain: boolean;
  readonly rookDash: boolean;
  readonly blindCapture: boolean;
}

export function createPosition(
  board: readonly number[], pool: ArrayLike<number>, quiet: number, rules: BqRules,
): Position {
  const position: Position = {
    board: Int8Array.from(board), pool: Int8Array.from(pool), alive: new Int32Array(2), down: 0, quiet,
    h0: 0, h1: 0, chain: rules.chain, rookDash: rules.rookDash, blindCapture: rules.blindCapture,
  };
  for (let cell = 0; cell < CELLS; cell++) {
    const slot = position.board[cell];
    position.h0 ^= keys.cell0[cell * 16 + slot + 2];
    position.h1 ^= keys.cell1[cell * 16 + slot + 2];
    if (slot === DOWN) position.down++;
    else if (slot >= 0) position.alive[COLOUR[slot]]++;
  }
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) {
    position.h0 ^= keys.pool0[piece * 8 + position.pool[piece]];
    position.h1 ^= keys.pool1[piece * 8 + position.pool[piece]];
    position.alive[COLOUR[piece]] += position.pool[piece];
  }
  return position;
}

/** Unseen pieces in all: what a flip's probabilities are taken from. */
export function poolTotal(position: Position): number {
  let total = 0;
  for (let piece = 0; piece < BQ_PIECE_COUNT; piece++) total += position.pool[piece];
  return total;
}

/** Writes a cell and keeps the hash current. */
export function setCell(position: Position, cell: number, value: number): void {
  const old = position.board[cell];
  position.h0 ^= keys.cell0[cell * 16 + old + 2] ^ keys.cell0[cell * 16 + value + 2];
  position.h1 ^= keys.cell1[cell * 16 + old + 2] ^ keys.cell1[cell * 16 + value + 2];
  position.board[cell] = value;
}

/** Moves a piece from the unseen pool onto the board's knowledge: one fewer face-down cell. */
export function drawFromPool(position: Position, piece: number): void {
  const count = position.pool[piece];
  position.h0 ^= keys.pool0[piece * 8 + count] ^ keys.pool0[piece * 8 + count - 1];
  position.h1 ^= keys.pool1[piece * 8 + count] ^ keys.pool1[piece * 8 + count - 1];
  position.pool[piece] = count - 1;
  position.down--;
}

export function returnToPool(position: Position, piece: number): void {
  const count = position.pool[piece];
  position.h0 ^= keys.pool0[piece * 8 + count] ^ keys.pool0[piece * 8 + count + 1];
  position.h1 ^= keys.pool1[piece * 8 + count] ^ keys.pool1[piece * 8 + count + 1];
  position.pool[piece] = count + 1;
  position.down++;
}

/** Transposition key halves of the position with `side` to move, inside a capture chain at `chain` (-1 for none). */
export function keyLow(position: Position, side: number, chain: number): number {
  return position.h0 ^ keys.side0[side] ^ keys.chain0[chain + 1]
    ^ (position.quiet >= QUIET_KEY_FROM ? keys.quiet0[position.quiet] : 0);
}

export function keyHigh(position: Position, side: number, chain: number): number {
  return position.h1 ^ keys.side1[side] ^ keys.chain1[chain + 1]
    ^ (position.quiet >= QUIET_KEY_FROM ? keys.quiet1[position.quiet] : 0);
}

/**
 * Appends the moves of the piece on `from` to `out` from index `count`, and returns the new count. With
 * `capturesOnly` only captures and blind attacks come, which is all a capture chain may continue with.
 */
export function generateFrom(position: Position, from: number, capturesOnly: boolean, out: Int32Array, count: number): number {
  const { board } = position;
  const piece = board[from];
  const colour = COLOUR[piece];
  const rank = RANK[piece];
  const blindOn = position.blindCapture;
  for (let direction = 0; direction < 4; direction++) {
    const ray = RAYS[from * 4 + direction];
    const length = ray.length;
    if (length === 0) continue;
    if (rank === BQ_CANNON) {
      if (!capturesOnly && board[ray[0]] === EMPTY) out[count++] = packMove(from, ray[0], QUIET);
      let index = 0;
      while (index < length && board[ray[index]] === EMPTY) index++;
      if (index >= length) continue;
      index++;
      while (index < length && board[ray[index]] === EMPTY) index++;
      if (index >= length) continue;
      const target = ray[index];
      const content = board[target];
      if (content >= 0) {
        if (COLOUR[content] !== colour) out[count++] = packMove(from, target, CAPTURE);
      } else if (content === DOWN && blindOn) out[count++] = packMove(from, target, BLIND);
    } else if (rank === BQ_CHARIOT && position.rookDash) {
      let index = 0;
      while (index < length && board[ray[index]] === EMPTY) {
        if (!capturesOnly) out[count++] = packMove(from, ray[index], QUIET);
        index++;
      }
      if (index < length) {
        const target = ray[index];
        const content = board[target];
        if (content >= 0) {
          if (CAN_CAPTURE[piece * 14 + content] === 1) out[count++] = packMove(from, target, CAPTURE);
        } else if (content === DOWN && blindOn) out[count++] = packMove(from, target, BLIND);
      }
    } else {
      const target = ray[0];
      const content = board[target];
      if (content === EMPTY) {
        if (!capturesOnly) out[count++] = packMove(from, target, QUIET);
      } else if (content >= 0) {
        if (CAN_CAPTURE[piece * 14 + content] === 1) out[count++] = packMove(from, target, CAPTURE);
      } else if (blindOn) out[count++] = packMove(from, target, BLIND);
    }
  }
  return count;
}

/** Appends every move of `colour`'s face-up pieces (flips excluded). */
export function generateAll(position: Position, colour: number, capturesOnly: boolean, out: Int32Array, count: number): number {
  for (let cell = 0; cell < CELLS; cell++) {
    const piece = position.board[cell];
    if (piece >= 0 && COLOUR[piece] === colour) count = generateFrom(position, cell, capturesOnly, out, count);
  }
  return count;
}
