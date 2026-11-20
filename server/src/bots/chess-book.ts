// ─── Chess opening book: hand-curated main lines of standard openings ───
//
// Each line is coordinate notation from the start position. Positions are keyed by the search's Zobrist hash, so
// the book also answers transpositions and either colour; a move's weight is the number of lines that play it.

import { chessInitialPosition } from '@shared/rules/chess';
import type { ChessPosition } from '@shared/rules/chess';
import { chessBoardState, chessGenerateMoves, chessMakeMove } from './chess-engine';

export const CHESS_BOOK_LINES: readonly string[] = [
  // Open games
  'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8',
  'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5 d1d8 e8d8',
  'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8',
  'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8e7 e1g1 e8g8 f1e1 d7d6',
  'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7 d1e2 f6d5',
  'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 b8c6 e1g1 f8e7',
  'e2e4 e7e5 b1c3 g8f6 g1f3 b8c6 d2d4 e5d4 f3d4 f8b4 d4c6 b7c6 f1d3 d7d5',
  // Sicilian
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6',
  'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 g7g6 c1e3 f8g7 f2f3 e8g8',
  'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7 c1e3 a7a6',
  'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6 c1g5 a7a6',
  'e2e4 c7c5 c2c3 g8f6 e4e5 f6d5 d2d4 c5d4 g1f3 b8c6 c3d4 d7d6',
  'e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6',
  // French, Caro-Kann, Scandinavian, Pirc
  'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7 f2f4 e8g8',
  'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6 a2a3 c5c4',
  'e2e4 e7e6 d2d4 d7d5 b1d2 g8f6 e4e5 f6d7 f1d3 c7c5 c2c3 b8c6',
  'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6 g1f3 b8d7',
  'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5 e1g1 b8c6',
  'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c8f5 f1c4 e7e6',
  'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7 f1e2 e8g8 e1g1 c7c6',
  // Closed games
  'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6 g5h4 b7b6',
  'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6',
  'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6 f1c4 f8b4',
  'd2d4 d7d5 c1f4 g8f6 e2e3 e7e6 g1f3 c7c5 c2c3 b8c6 b1d2 f8d6',
  'd2d4 d7d5 g1f3 g8f6 c2c4 e7e6 b1c3 c7c6 e2e3 b8d7 f1d3 d5c4 d3c4 b7b5',
  // Indian defences
  'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5 e1g1 b8c6',
  'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5 e1g1 b8c6',
  'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8 b1c3 f6e4',
  'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7 g1f3 c7c5',
  'd2d4 g8f6 c2c4 e7e6 g2g3 d7d5 f1g2 f8e7 g1f3 e8g8 e1g1 d5c4',
  'd2d4 g8f6 c2c4 c7c5 d4d5 e7e6 b1c3 e6d5 c4d5 d7d6 e2e4 g7g6 g1f3 f8g7',
  'd2d4 f7f5 g2g3 g8f6 f1g2 e7e6 g1f3 f8e7 e1g1 e8g8 c2c4 d7d6',
  // Flank openings
  'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6',
  'c2c4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 g1f3 e7e6 e1g1 g8e7',
  'c2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4 e5f6 d4c3 b2c3 d8f6',
  'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8 b1d2 c7c5',
  'g1f3 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 d2d4 e8g8',
];

const SQUARE = (name: string): number => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
const PROMOTION: Readonly<Record<string, number>> = { n: 2, b: 3, r: 4, q: 5 };

/** Packed move of coordinate text (`e2e4`, `e7e8q`). */
export function chessBookCode(text: string): number {
  return SQUARE(text.slice(0, 2)) | (SQUARE(text.slice(2, 4)) << 6) | ((PROMOTION[text[4]] ?? 0) << 12);
}

const keyOf = (low: number, high: number): string => `${low >>> 0}:${high >>> 0}`;

let book: Map<string, Map<number, number>> | null = null;

/** Builds the book on first use; a line stops at its first move that is not legal (tests keep them all legal). */
function bookTable(): Map<string, Map<number, number>> {
  if (book) return book;
  const table = new Map<string, Map<number, number>>();
  const moves = new Int32Array(256);
  for (const line of CHESS_BOOK_LINES) {
    const state = chessBoardState(chessInitialPosition());
    for (const text of line.split(' ')) {
      const move = chessBookCode(text);
      const end = chessGenerateMoves(state, moves, 0, false);
      if (!moves.subarray(0, end).includes(move)) break;
      const key = keyOf(state.hashLow, state.hashHigh);
      const entry = table.get(key) ?? new Map<number, number>();
      entry.set(move, (entry.get(move) ?? 0) + 1);
      table.set(key, entry);
      chessMakeMove(state, move);
    }
  }
  book = table;
  return table;
}

/** A book move for `position` among `legal` moves, weighted by how many lines play it, or null. */
export function chessBookMove(position: ChessPosition, legal: readonly number[], random: () => number): number | null {
  const state = chessBoardState(position);
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
