import { CHESS_CELLS, chessIndex } from '@shared/rules/chess';
import type { ChessCastling, ChessCell, ChessMove, ChessPosition, ChessPromotion } from '@shared/rules/chess';

/** A position from FEN; the move counters are optional and the fullmove number is ignored. */
export function chessFen(fen: string): ChessPosition {
  const [placement, turn, rights = '-', target = '-', halfmove = '0'] = fen.trim().split(/\s+/);
  const board: ChessCell[] = [];
  for (const char of placement.replace(/\//g, '')) {
    if (/\d/.test(char)) for (let index = 0; index < Number(char); index++) board.push(null);
    else board.push(char as ChessCell);
  }
  if (board.length !== CHESS_CELLS) throw new Error('Invalid FEN');
  const castling: ChessCastling = { K: rights.includes('K'), Q: rights.includes('Q'), k: rights.includes('k'), q: rights.includes('q') };
  const enPassant = target === '-' ? null : chessIndex(target.charCodeAt(0) - 97, 8 - Number(target[1]));
  return { board, turn: turn === 'w' ? 0 : 1, castling, enPassant, halfmove: Number(halfmove) };
}

/** A move from coordinate text such as `e2e4` or `e7e8q`. */
export function chessMoveOf(text: string): ChessMove {
  const square = (name: string): number => chessIndex(name.charCodeAt(0) - 97, 8 - Number(name[1]));
  const promotion = text[4] as ChessPromotion | undefined;
  return { from: square(text.slice(0, 2)), to: square(text.slice(2, 4)), ...promotion ? { promotion } : {} };
}

/** Seeded linear congruential generator for reproducible playouts. */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
