// ─── Xiangqi opening book: hand-curated main lines of standard openings ───
//
// Lines are ICCS coordinates (files a–i from red's left, ranks 0–9 from red's back rank) from the standard start;
// handicap starts never match. Positions are keyed by the search's Zobrist hash, so transpositions and either
// colour are answered; a move's weight is the number of lines that play it.

import { xqInitialBoard } from '@shared/rules/xiangqi';
import type { XqBoardState } from './xiangqi-engine';
import { xqBoardState, xqGenerateMoves, xqMakeMove } from './xiangqi-engine';

export const XIANGQI_BOOK_LINES: readonly string[] = [
  // 中炮對屏風馬
  'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5 b0c2 f9e8',
  'h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 h0h6 c6c5 b0c2 h7i7 h6h9 g7h9',
  'h2e2 h9g7 h0g2 b9c7 i0h0 i9h9 g3g4 c6c5 b0a2 h7i7',
  'h2e2 h9g7 h0g2 i9h9 i0i1 b9c7 i1f1 c9e7',
  // 中炮對反宮馬、三步虎、單提馬
  'h2e2 b9c7 h0g2 h7f7 i0h0 h9g7 c3c4 i9h9',
  'h2e2 h9g7 h0g2 h7i7 i0h0 i9h9 b0c2 g6g5',
  'h2e2 b9a7 h0g2 h9g7 i0h0 i9h9',
  // 順炮、列炮
  'h2e2 h7e7 h0g2 h9g7 i0h0 i9h9 b0c2 b9c7',
  'h2e2 b7e7 h0g2 b9c7 i0h0 a9b9 b0c2 h9g7',
  // 仙人指路
  'c3c4 g6g5 b0c2 h9g7 h0g2 b9c7 g0e2 c9e7',
  'c3c4 b7c7 h2e2 c9e7 h0g2 b9d8',
  'c3c4 c9e7 h2e2 h9g7 h0g2 g6g5',
  // 飛相局
  'g0e2 g6g5 h0g2 h9g7 i0h0 i9h9 c3c4 b9c7',
  'g0e2 h7e7 h0g2 h9g7 i0h0 i9h9',
  'c0e2 h7e7 b0c2 h9g7 a0b0 i9h9',
  // 起馬局
  'h0g2 g6g5 c3c4 h9g7 b0c2 b9c7 g0e2',
  'b0c2 g6g5 g3g4 h9g7 h0g2 b9c7',
  // 過宮炮
  'h2d2 h9g7 h0g2 i9h9 i0h0 b9c7',
  // 士角炮、對兵局
  'b2d2 h9g7 b0c2 b9c7 a0b0 a9b9',
  'g3g4 c6c5 h0g2 b9c7 b0c2 h9g7',
];

const CELL = (text: string): number => (9 - Number(text[1])) * 9 + (text.charCodeAt(0) - 97);

/** Packed move (`from << 7 | to`) of ICCS text such as `h2e2`. */
export function xiangqiBookCode(text: string): number {
  return (CELL(text.slice(0, 2)) << 7) | CELL(text.slice(2, 4));
}

const keyOf = (low: number, high: number): string => `${low >>> 0}:${high >>> 0}`;

let book: Map<string, Map<number, number>> | null = null;

function bookTable(): Map<string, Map<number, number>> {
  if (book) return book;
  const table = new Map<string, Map<number, number>>();
  const moves = new Int32Array(128);
  for (const line of XIANGQI_BOOK_LINES) {
    const state = xqBoardState(xqInitialBoard(), 0, []);
    for (const text of line.split(' ')) {
      const move = xiangqiBookCode(text);
      const end = xqGenerateMoves(state, moves, 0, false);
      if (!moves.subarray(0, end).includes(move)) break;
      const key = keyOf(state.hashLow, state.hashHigh);
      const entry = table.get(key) ?? new Map<number, number>();
      entry.set(move, (entry.get(move) ?? 0) + 1);
      table.set(key, entry);
      xqMakeMove(state, move);
    }
  }
  book = table;
  return table;
}

/** A book move for the position among `legal` moves, weighted by how many lines play it, or null. */
export function xiangqiBookMove(state: XqBoardState, legal: readonly number[], random: () => number): number | null {
  const entry = bookTable().get(keyOf(state.hashLow, state.hashHigh));
  if (!entry) return null;
  const choices = [...entry].filter(([move]) => legal.includes(move));
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [move, weight] of choices) {
    roll -= weight;
    if (roll < 0) return move;
  }
  return choices.length > 0 ? choices[choices.length - 1][0] : null;
}
