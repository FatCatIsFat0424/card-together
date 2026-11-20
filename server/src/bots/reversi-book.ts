// ─── Reversi opening book: deeply searched replies for the first moves, keyed by position up to symmetry ───
//
// Written by `npm run reversi:book` (scripts/reversi-training/book.ts) into `reversi-book.bin`: one 17-byte
// record per position (the four bitboard halves of the canonical image, little-endian, then the move in that
// image), sorted by key. A position and its seven mirror images share one record.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SYMMETRIES, transform } from './reversi-board';
import type { Bitboards } from './reversi-board';

export const REVERSI_BOOK_PATH = fileURLToPath(new URL('./reversi-book.bin', import.meta.url));
export const BOOK_RECORD_BYTES = 17;

/** `INVERSE[s][cell]`: the cell that symmetry `s` maps onto `cell`. */
const INVERSE: readonly Int8Array[] = SYMMETRIES.map((map) => {
  const inverse = new Int8Array(64);
  map.forEach((to, from) => {
    inverse[to] = from;
  });
  return inverse;
});

const unsigned = (value: number): number => value >>> 0;

/** Orders positions by high halves first, as unsigned numbers. */
export function compareBoards(a: Bitboards, b: Bitboards): number {
  return unsigned(a.ph) - unsigned(b.ph) || unsigned(a.pl) - unsigned(b.pl)
    || unsigned(a.oh) - unsigned(b.oh) || unsigned(a.ol) - unsigned(b.ol);
}

/** The smallest of the position's eight images and the symmetry that produces it. */
export function canonicalBoard(board: Bitboards): { board: Bitboards; symmetry: number } {
  let best: Bitboards = { pl: board.pl, ph: board.ph, ol: board.ol, oh: board.oh };
  let symmetry = 0;
  for (let s = 1; s < 8; s++) {
    const image = transform(board, s);
    if (compareBoards(image, best) < 0) {
      best = image;
      symmetry = s;
    }
  }
  return { board: best, symmetry };
}

interface Book {
  readonly keys: Int32Array;
  readonly moves: Int8Array;
}

let loaded: Book | null = null;

/** Parses book bytes, failing fast on a malformed file. */
export function parseBook(bytes: Uint8Array): Book {
  if (bytes.length % BOOK_RECORD_BYTES !== 0) throw new Error('Reversi book has a partial record; run npm run reversi:book.');
  const count = bytes.length / BOOK_RECORD_BYTES;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const keys = new Int32Array(count * 4);
  const moves = new Int8Array(count);
  for (let k = 0; k < count; k++) {
    for (let word = 0; word < 4; word++) keys[k * 4 + word] = view.getInt32(k * BOOK_RECORD_BYTES + word * 4, true);
    moves[k] = view.getInt8(k * BOOK_RECORD_BYTES + 16);
    if (moves[k] < 0 || moves[k] > 63) throw new Error('Reversi book has an invalid move.');
  }
  return { keys, moves };
}

function book(): Book {
  loaded ??= parseBook(readFileSync(REVERSI_BOOK_PATH));
  return loaded;
}

/** The book move for the side to move, or -1 when the position is not in the book. */
export function bookMove(board: Bitboards): number {
  const { keys, moves } = book();
  const { board: key, symmetry } = canonicalBoard(board);
  let low = 0;
  let high = moves.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const order = compareBoards(
      { pl: keys[middle * 4], ph: keys[middle * 4 + 1], ol: keys[middle * 4 + 2], oh: keys[middle * 4 + 3] }, key,
    );
    if (order === 0) return INVERSE[symmetry][moves[middle]];
    if (order < 0) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

/** Serializes book entries (canonical boards with their moves in the canonical image), sorted by key. */
export function encodeBook(entries: readonly { readonly board: Bitboards; readonly move: number }[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => compareBoards(a.board, b.board));
  const bytes = new Uint8Array(sorted.length * BOOK_RECORD_BYTES);
  const view = new DataView(bytes.buffer);
  sorted.forEach(({ board, move }, k) => {
    [board.pl, board.ph, board.ol, board.oh].forEach((word, index) => view.setInt32(k * BOOK_RECORD_BYTES + index * 4, word, true));
    view.setInt8(k * BOOK_RECORD_BYTES + 16, move);
  });
  return bytes;
}
