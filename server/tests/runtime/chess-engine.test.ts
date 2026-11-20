import { describe, expect, it } from 'vitest';
import {
  CHESS_BISHOP, CHESS_KING, CHESS_KNIGHT, CHESS_PAWN, CHESS_QUEEN, CHESS_ROOK, chessApply, chessInitialPosition, chessIsLegal,
  chessLegalMoves, chessPerft, chessPositionKey,
} from '@shared/rules/chess';
import type { ChessCell, ChessPosition } from '@shared/rules/chess';
import {
  SEE_VALUE, chessBoardState, chessGenerateMoves, chessHashOf, chessHashOfKey, chessMakeMove, chessRepetition, chessSee,
  chessSetHistory, chessStateInCheck, chessUnmakeMove,
} from '../../src/bots/chess-engine';
import type { ChessBoardState } from '../../src/bots/chess-engine';
import { chessEvaluateWhite } from '../../src/bots/chess-eval';
import { CHESS_BOOK_LINES, chessBookCode, chessBookMove } from '../../src/bots/chess-book';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { chessFen, chessMoveOf } from '../fixtures/chess-positions';

const POSITIONS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
];

/** Legal-move leaf count of the bot board; counts nodes whose incremental hash or undo went wrong in `faults`. */
function perft(state: ChessBoardState, depth: number, faults: { count: number }): number {
  const moves = new Int32Array(256);
  const end = chessGenerateMoves(state, moves, 0, false);
  const squares = state.squares.join();
  const low = state.hashLow;
  let total = 0;
  for (const move of moves.subarray(0, end)) {
    chessMakeMove(state, move);
    if (!chessStateInCheck(state, state.side === 0 ? 1 : 0)) {
      const hash = chessHashOf(state.squares, state.side, state.castling, state.enPassant);
      if (hash.low !== state.hashLow || hash.high !== state.hashHigh) faults.count++;
      total += depth <= 1 ? 1 : perft(state, depth - 1, faults);
    }
    chessUnmakeMove(state, move);
  }
  if (state.squares.join() !== squares || state.hashLow !== low) faults.count++;
  return total;
}

/** The position with colours swapped and the board mirrored top to bottom. */
function flipped(position: ChessPosition): ChessPosition {
  const swap = (cell: ChessCell): ChessCell => (cell === null ? null : (cell === cell.toUpperCase() ? cell.toLowerCase() : cell.toUpperCase()) as ChessCell);
  return {
    board: position.board.map((_, square) => swap(position.board[square ^ 56])),
    turn: position.turn === 0 ? 1 : 0,
    castling: { K: position.castling.k, Q: position.castling.q, k: position.castling.K, q: position.castling.Q },
    enPassant: position.enPassant === null ? null : position.enPassant ^ 56,
    halfmove: position.halfmove,
  };
}

describe('chess bot board', () => {
  it('uses the shared rules engine codes', () => {
    expect([CHESS_PAWN, CHESS_KNIGHT, CHESS_BISHOP, CHESS_ROOK, CHESS_QUEEN, CHESS_KING]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('generates the same moves as the shared rules (perft) and keeps its hash and undo exact', () => {
    for (const fen of POSITIONS) {
      const position = chessFen(fen);
      const faults = { count: 0 };
      expect(perft(chessBoardState(position), 3, faults), fen).toBe(chessPerft(position, 3));
      expect(faults.count, fen).toBe(0);
    }
  }, 30_000);

  it('hashes positions like the keys the game history records', () => {
    let position = chessInitialPosition();
    for (const text of ['e2e4', 'c7c5', 'e4e5', 'd7d5']) {
      position = chessApply(position, chessMoveOf(text));
      const state = chessBoardState(position);
      const key = chessHashOfKey(chessPositionKey(position));
      expect([key.low, key.high]).toEqual([state.hashLow, state.hashHigh]);
    }
  });

  it('counts repetitions inside the search line and before the root', () => {
    const start = chessFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const state = chessBoardState(start);
    for (const text of ['a1a2', 'e8d8', 'a2a1', 'd8e8']) chessMakeMove(state, chessBookCode(text));
    expect(chessRepetition(state)).toBe(2);

    // The same cycle played before the root: once is not yet a draw, twice is.
    const keys: string[] = [];
    let position = start;
    for (const text of ['a1a2', 'e8d8', 'a2a1', 'd8e8', 'a1a2', 'e8d8', 'a2a1', 'd8e8']) {
      keys.push(chessPositionKey(position));
      position = chessApply(position, chessMoveOf(text));
    }
    const once = chessBoardState(position);
    chessSetHistory(once, keys.slice(4));
    expect(chessRepetition(once)).toBe(1);
    const twice = chessBoardState(position);
    chessSetHistory(twice, keys);
    expect(chessRepetition(twice)).toBe(2);
  });

  it('scores exchanges with least-valuable recaptures and x-rays', () => {
    const rook = chessFen('1k1r4/1pp4p/p7/4p3/8/P5P1/1PP4P/2K1R3 w - -');
    expect(chessSee(chessBoardState(rook), chessBookCode('e1e5'))).toBe(SEE_VALUE[CHESS_PAWN]);
    const knight = chessFen('1k1r3q/1ppn3p/p4b2/4p3/8/P2N2P1/1PP1R1BP/2K1Q3 w - -');
    expect(chessSee(chessBoardState(knight), chessBookCode('d3e5'))).toBe(SEE_VALUE[CHESS_PAWN] - SEE_VALUE[CHESS_KNIGHT]);
  });

  it('evaluates both colours alike', () => {
    let position = chessInitialPosition();
    const random = seededRandom(5);
    for (let ply = 0; ply < 60; ply++) {
      const white = chessEvaluateWhite(chessBoardState(position), null);
      expect(chessEvaluateWhite(chessBoardState(flipped(position)), null) + white).toBe(0);
      const moves = chessLegalMoves(position);
      if (moves.length === 0) break;
      position = chessApply(position, moves[Math.floor(random() * moves.length)]);
    }
  });

  it('scores dead draws zero', () => {
    expect(chessEvaluateWhite(chessBoardState(chessFen('8/8/4k3/8/8/2N5/8/4K3 w - -')), null)).toBe(0);
  });
});

describe('chess opening book', () => {
  it('holds only legal lines', () => {
    for (const line of CHESS_BOOK_LINES) {
      let position = chessInitialPosition();
      for (const text of line.split(' ')) {
        const move = chessMoveOf(text);
        expect(chessIsLegal(position, move), `${line}: ${text}`).toBe(true);
        position = chessApply(position, move);
      }
    }
  });

  it('answers the start position with varied main-line moves and stays silent outside the book', () => {
    const start = chessInitialPosition();
    const legal = chessLegalMoves(start).map((move) => chessBookCode(`${'abcdefgh'[move.from % 8]}${8 - Math.floor(move.from / 8)}${'abcdefgh'[move.to % 8]}${8 - Math.floor(move.to / 8)}`));
    const picks = new Set(Array.from({ length: 20 }, (_, seed) => chessBookMove(start, legal, seededRandom(seed + 1))));
    expect(picks.size).toBeGreaterThan(1);
    for (const pick of picks) expect(['e2e4', 'd2d4', 'c2c4', 'g1f3'].map(chessBookCode)).toContain(pick);
    const odd = chessApply(start, chessMoveOf('a2a4'));
    expect(chessBookMove(odd, [], seededRandom(1))).toBeNull();
  });
});
