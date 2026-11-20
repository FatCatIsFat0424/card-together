// ─── Reversi bitboards: 64-bit boards as two signed 32-bit halves, move generation, and flips ───
//
// Cell `index = row * 8 + col` (as in `@shared/rules/reversi`) is bit `index` of the board: cells 0–31 live in
// the low half, cells 32–63 in the high half. BigInt is far slower than two int32 halves in V8, so every
// operation below works on the halves directly. Results that are bitboards come back through the module's
// scratch halves (`out`), which callers copy before the next call; nothing here allocates.

import type { RvDiscs, RvSide } from '@shared/rules/reversi';

/** Bitboard result slots: written by `moves` and `flips`, read immediately by the caller. */
export const out = { lo: 0, hi: 0 };

/** Columns b–h and a–g: a shift toward a higher column must not land in column a, and vice versa. */
const NOT_A = 0xfefefefe | 0;
const NOT_H = 0x7f7f7f7f;
/** Columns b–g: an opponent run along a row or diagonal never wraps through these. */
const INNER = 0x7e7e7e7e;

/** Squares `side to move` can play: one dumb7fill per direction, with wrap masks for the sideways ones. */
export function moves(pl: number, ph: number, ol: number, oh: number): void {
  const el = ~(pl | ol);
  const eh = ~(ph | oh);
  const il = ol & INNER;
  const ih = oh & INNER;
  let ml = 0;
  let mh = 0;
  let tl: number;
  let th: number;
  let nl: number;
  let nh: number;

  // +1 (east): shift left by 1.
  tl = (pl << 1) & il;
  th = ((ph << 1) | (pl >>> 31)) & ih;
  for (let step = 0; step < 5; step++) {
    nl = tl << 1;
    nh = (th << 1) | (tl >>> 31);
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= (tl << 1) & el & NOT_A;
  mh |= ((th << 1) | (tl >>> 31)) & eh & NOT_A;

  // -1 (west): shift right by 1.
  tl = ((pl >>> 1) | (ph << 31)) & il;
  th = (ph >>> 1) & ih;
  for (let step = 0; step < 5; step++) {
    nl = (tl >>> 1) | (th << 31);
    nh = th >>> 1;
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= ((tl >>> 1) | (th << 31)) & el & NOT_H;
  mh |= (th >>> 1) & eh & NOT_H;

  // +8 (down a row).
  tl = (pl << 8) & ol;
  th = ((ph << 8) | (pl >>> 24)) & oh;
  for (let step = 0; step < 5; step++) {
    nl = tl << 8;
    nh = (th << 8) | (tl >>> 24);
    tl |= nl & ol;
    th |= nh & oh;
  }
  ml |= (tl << 8) & el;
  mh |= ((th << 8) | (tl >>> 24)) & eh;

  // -8 (up a row).
  tl = ((pl >>> 8) | (ph << 24)) & ol;
  th = (ph >>> 8) & oh;
  for (let step = 0; step < 5; step++) {
    nl = (tl >>> 8) | (th << 24);
    nh = th >>> 8;
    tl |= nl & ol;
    th |= nh & oh;
  }
  ml |= ((tl >>> 8) | (th << 24)) & el;
  mh |= (th >>> 8) & eh;

  // +9 (down-right).
  tl = (pl << 9) & il;
  th = ((ph << 9) | (pl >>> 23)) & ih;
  for (let step = 0; step < 5; step++) {
    nl = tl << 9;
    nh = (th << 9) | (tl >>> 23);
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= (tl << 9) & el & NOT_A;
  mh |= ((th << 9) | (tl >>> 23)) & eh & NOT_A;

  // -9 (up-left).
  tl = ((pl >>> 9) | (ph << 23)) & il;
  th = (ph >>> 9) & ih;
  for (let step = 0; step < 5; step++) {
    nl = (tl >>> 9) | (th << 23);
    nh = th >>> 9;
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= ((tl >>> 9) | (th << 23)) & el & NOT_H;
  mh |= (th >>> 9) & eh & NOT_H;

  // +7 (down-left).
  tl = (pl << 7) & il;
  th = ((ph << 7) | (pl >>> 25)) & ih;
  for (let step = 0; step < 5; step++) {
    nl = tl << 7;
    nh = (th << 7) | (tl >>> 25);
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= (tl << 7) & el & NOT_H;
  mh |= ((th << 7) | (tl >>> 25)) & eh & NOT_H;

  // -7 (up-right).
  tl = ((pl >>> 7) | (ph << 25)) & il;
  th = (ph >>> 7) & ih;
  for (let step = 0; step < 5; step++) {
    nl = (tl >>> 7) | (th << 25);
    nh = th >>> 7;
    tl |= nl & il;
    th |= nh & ih;
  }
  ml |= ((tl >>> 7) | (th << 25)) & el & NOT_A;
  mh |= (th >>> 7) & eh & NOT_A;

  out.lo = ml;
  out.hi = mh;
}

/** Number of set bits in a 32-bit word. */
export function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/** Legal move count for the side to move. */
export function mobility(pl: number, ph: number, ol: number, oh: number): number {
  moves(pl, ph, ol, oh);
  return popcount(out.lo) + popcount(out.hi);
}

/** Index of the lowest set bit of a nonzero word. */
export const lowestBit = (x: number): number => 31 - Math.clz32(x & -x);

/** Bit masks of every cell in each half: exactly one of the two is nonzero. */
export const CELL_LO = new Int32Array(64);
export const CELL_HI = new Int32Array(64);
for (let index = 0; index < 64; index++) {
  if (index < 32) CELL_LO[index] = (1 << index) | 0;
  else CELL_HI[index] = (1 << (index - 32)) | 0;
}

/** For every cell and direction, the cells along the ray to the edge: `RAY_CELLS[RAY_START[i * 8 + d] + k]`. */
const RAY_START = new Int16Array(64 * 8);
const RAY_LENGTH = new Int8Array(64 * 8);
const RAY_CELLS: Int8Array = (() => {
  const cells: number[] = [];
  const directions = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (let index = 0; index < 64; index++) {
    const col = index & 7;
    const row = index >> 3;
    directions.forEach(([dc, dr], direction) => {
      RAY_START[index * 8 + direction] = cells.length;
      let length = 0;
      for (let c = col + dc, r = row + dr; c >= 0 && c < 8 && r >= 0 && r < 8; c += dc, r += dr) {
        cells.push(r * 8 + c);
        length++;
      }
      RAY_LENGTH[index * 8 + direction] = length;
    });
  }
  return Int8Array.from(cells);
})();

/**
 * Discs the side to move flips by playing `index` (the move square itself excluded), written to `out`.
 * Zero for an occupied square or an illegal move.
 */
export function flips(index: number, pl: number, ph: number, ol: number, oh: number): void {
  let fl = 0;
  let fh = 0;
  const base = index * 8;
  for (let direction = 0; direction < 8; direction++) {
    const length = RAY_LENGTH[base + direction];
    if (length < 2) continue;
    let start = RAY_START[base + direction];
    let cell = RAY_CELLS[start];
    let lo = CELL_LO[cell];
    let hi = CELL_HI[cell];
    if (((ol & lo) | (oh & hi)) === 0) continue;
    let rl = lo;
    let rh = hi;
    const end = start + length;
    for (start++; start < end; start++) {
      cell = RAY_CELLS[start];
      lo = CELL_LO[cell];
      hi = CELL_HI[cell];
      if (((ol & lo) | (oh & hi)) !== 0) {
        rl |= lo;
        rh |= hi;
      } else {
        if (((pl & lo) | (ph & hi)) !== 0) {
          fl |= rl;
          fh |= rh;
        }
        break;
      }
    }
  }
  out.lo = fl;
  out.hi = fh;
}

/** Disc difference (side to move minus opponent) of a finished board. */
export function discDifference(pl: number, ph: number, ol: number, oh: number): number {
  return popcount(pl) + popcount(ph) - popcount(ol) - popcount(oh);
}

/** A position from one side's point of view: its discs (`p`) and the opponent's (`o`). */
export interface Bitboards {
  readonly pl: number;
  readonly ph: number;
  readonly ol: number;
  readonly oh: number;
}

/** The view's discs as bitboards for `side` to move. */
export function fromDiscs(discs: RvDiscs, side: RvSide): Bitboards {
  let pl = 0;
  let ph = 0;
  let ol = 0;
  let oh = 0;
  for (let index = 0; index < 64; index++) {
    const cell = discs[index];
    if (cell === null || cell === undefined) continue;
    if (cell === side) {
      pl |= CELL_LO[index];
      ph |= CELL_HI[index];
    } else {
      ol |= CELL_LO[index];
      oh |= CELL_HI[index];
    }
  }
  return { pl, ph, ol, oh };
}

/** Whether cell `index` is set in a board given as halves. */
export const hasCell = (lo: number, hi: number, index: number): boolean => ((lo & CELL_LO[index]) | (hi & CELL_HI[index])) !== 0;

/** Cell indices of the set bits, ascending. */
export function cellsOf(lo: number, hi: number): number[] {
  const cells: number[] = [];
  for (let index = 0; index < 64; index++) if (hasCell(lo, hi, index)) cells.push(index);
  return cells;
}

/** The eight symmetries of the square as cell maps: `SYMMETRIES[s][index]` is where `index` goes. */
export const SYMMETRIES: readonly Int8Array[] = (() => {
  const maps: Int8Array[] = [];
  for (let s = 0; s < 8; s++) {
    const map = new Int8Array(64);
    for (let index = 0; index < 64; index++) {
      let col = index & 7;
      let row = index >> 3;
      if (s & 1) col = 7 - col;
      if (s & 2) row = 7 - row;
      if (s & 4) [col, row] = [row, col];
      map[index] = row * 8 + col;
    }
    maps.push(map);
  }
  return maps;
})();

/** A board mapped through symmetry `s`. */
export function transform(board: Bitboards, s: number): Bitboards {
  const map = SYMMETRIES[s];
  let pl = 0;
  let ph = 0;
  let ol = 0;
  let oh = 0;
  for (let index = 0; index < 64; index++) {
    const to = map[index];
    if (hasCell(board.pl, board.ph, index)) {
      pl |= CELL_LO[to];
      ph |= CELL_HI[to];
    } else if (hasCell(board.ol, board.oh, index)) {
      ol |= CELL_LO[to];
      oh |= CELL_HI[to];
    }
  }
  return { pl, ph, ol, oh };
}
