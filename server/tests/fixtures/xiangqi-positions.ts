import type { XqCell } from '@shared/rules/xiangqi';

/** A position from ten rows of nine characters, top (black's back rank) first: `.` empty, uppercase red. */
export function xqPosition(rows: readonly string[]): XqCell[] {
  if (rows.length !== 10 || rows.some((row) => row.length !== 9)) throw new Error('Expected 10 rows of 9 points');
  return rows.join('').split('').map((char) => (char === '.' ? null : char as XqCell));
}

/** A position from Xiangqi FEN, which writes elephants as B and horses as N. */
export function xqFen(fen: string): XqCell[] {
  const cells: XqCell[] = [];
  for (const char of fen.split(' ')[0].replace(/\//g, '')) {
    if (/\d/.test(char)) {
      for (let index = 0; index < Number(char); index++) cells.push(null);
      continue;
    }
    const lower = char.toLowerCase();
    const kind = lower === 'b' ? 'e' : lower === 'n' ? 'h' : lower;
    cells.push((char === lower ? kind : kind.toUpperCase()) as XqCell);
  }
  if (cells.length !== 90) throw new Error('Invalid FEN');
  return cells;
}

/** Seeded linear congruential generator for reproducible playouts. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
