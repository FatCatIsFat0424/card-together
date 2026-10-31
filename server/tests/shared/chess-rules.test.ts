import { describe, expect, it } from 'vitest';
import {
  CHESS_FIFTY_MOVE_PLIES, chessApply, chessCell, chessInCheck, chessInitialPosition, chessInsufficientMaterial, chessIsLegal,
  chessLegalMoves, chessMoveFacts, chessNode, chessPerft, chessPositionKey, chessReplay, chessSan, chessSquareName,
  chessVerdict,
} from '@shared/rules/chess';
import type { ChessMove, ChessPosition } from '@shared/rules/chess';
import { chessFen, chessMoveOf, lcg } from '../fixtures/chess-positions';

const START = chessInitialPosition();
const KIWIPETE = chessFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');

const names = (position: ChessPosition): string[] =>
  chessLegalMoves(position).map((move) => `${chessSquareName(move.from)}${chessSquareName(move.to)}${move.promotion ?? ''}`).sort();

/** Plays coordinate moves from `start`, returning the final position and the earlier keys. */
const play = (moves: string, start: ChessPosition = START): ReturnType<typeof chessReplay> =>
  chessReplay(moves.split(' ').filter(Boolean).map(chessMoveOf), start);

const san = (position: ChessPosition, text: string): string => chessSan(position, chessMoveOf(text));

describe('chess move generation', () => {
  it('counts legal move sequences from the start position (perft)', () => {
    expect([1, 2, 3].map((depth) => chessPerft(START, depth))).toEqual([20, 400, 8902]);
  });

  it.each([
    ['Kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['endgame with en passant pins', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['castling and promotions', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['promotion captures', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ])('matches the known perft counts of %s', (_name, fen, counts) => {
    const position = chessFen(fen);
    counts.forEach((count, index) => expect(chessPerft(position, index + 1)).toBe(count));
  });

  it('never mutates its input', () => {
    const before = JSON.stringify(KIWIPETE);
    chessLegalMoves(KIWIPETE);
    chessApply(KIWIPETE, chessMoveOf('e1g1'));
    chessPerft(KIWIPETE, 2);
    expect(JSON.stringify(KIWIPETE)).toBe(before);
  });

  it('maps squares to board nodes and back', () => {
    expect(chessSquareName(0)).toBe('a8');
    expect(chessSquareName(63)).toBe('h1');
    expect(chessCell(chessNode(52))).toBe(52);
    expect(chessCell('8,0')).toBeNull();
  });

  it('castles on both wings when the path is clear and safe', () => {
    const moves = names(KIWIPETE);
    expect(moves).toContain('e1g1');
    expect(moves).toContain('e1c1');
    const after = chessApply(KIWIPETE, chessMoveOf('e1g1'));
    expect(after.board[chessCell('6,7')!]).toBe('K');
    expect(after.board[chessCell('5,7')!]).toBe('R');
    expect(after.castling).toEqual({ K: false, Q: false, k: true, q: true });
  });

  it('forbids castling out of, through, and into check, and with a piece between', () => {
    expect(names(chessFen('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1'))).not.toContain('e1g1');
    expect(names(chessFen('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1'))).not.toContain('e1g1');
    expect(names(chessFen('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1'))).not.toContain('e1g1');
    expect(names(chessFen('4k3/8/8/8/8/8/3r4/R3K2R w KQ - 0 1'))).not.toContain('e1c1');
    expect(names(chessFen('4k3/8/8/8/8/8/1r6/R3K2R w KQ - 0 1'))).toContain('e1c1');
    expect(names(chessFen('4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1'))).not.toContain('e1c1');
  });

  it('loses castling rights when the king or a rook moves or the rook is captured', () => {
    expect(chessApply(KIWIPETE, chessMoveOf('h1g1')).castling).toMatchObject({ K: false, Q: true });
    expect(chessApply(KIWIPETE, chessMoveOf('a1b1')).castling).toMatchObject({ K: true, Q: false });
    expect(chessApply(KIWIPETE, chessMoveOf('e1d1')).castling).toMatchObject({ K: false, Q: false });
    const taken = chessApply(chessFen('r3k2r/8/8/8/8/8/6B1/4K3 w kq - 0 1'), chessMoveOf('g2a8'));
    expect(taken.castling).toMatchObject({ k: true, q: false });
  });

  it('captures en passant only on the move right after the double step', () => {
    const position = play('e2e4 a7a6 e4e5 d7d5').position;
    expect(position.enPassant).toBe(chessCell('3,2'));
    expect(names(position)).toContain('e5d6');
    const taken = chessApply(position, chessMoveOf('e5d6'));
    expect(taken.board[chessCell('3,3')!]).toBeNull();
    expect(taken.board[chessCell('3,2')!]).toBe('P');
    expect(names(play('e2e4 a7a6 e4e5 d7d5 g1f3 a6a5').position)).not.toContain('e5d6');
  });

  it('rejects an en passant capture that exposes the king along the rank', () => {
    const position = chessFen('8/8/8/KPp4r/8/8/8/7k w - c6 0 1');
    expect(names(position)).not.toContain('b5c6');
  });

  it('offers all four promotions, with and without capture', () => {
    const position = chessFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const moves = names(position).filter((move) => move.startsWith('a7'));
    expect(moves).toEqual(['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r', 'a7b8b', 'a7b8n', 'a7b8q', 'a7b8r']);
    expect(chessIsLegal(position, chessMoveOf('a7a8'))).toBe(false);
    expect(chessApply(position, chessMoveOf('a7b8n')).board[1]).toBe('N');
  });

  it('does not let a pinned piece or a king step into check', () => {
    const position = chessFen('4k3/8/8/8/4r3/8/4B3/4K3 w - - 0 1');
    expect(names(position).filter((move) => move.startsWith('e2'))).toEqual([]);
    expect(names(position)).toEqual(['e1d1', 'e1d2', 'e1f1', 'e1f2']);
    expect(chessInCheck(chessFen('4k3/8/8/8/4r3/8/8/4K3 w - - 0 1'))).toBe(true);
  });
});

describe('chess verdicts', () => {
  it('declares checkmate with the mated side as the loser', () => {
    const { position, history } = play('f2f3 e7e5 g2g4 d8h4');
    expect(chessVerdict(position, history)).toEqual({ reason: 'checkmate', loser: 0 });
  });

  it('declares stalemate a draw', () => {
    const position = chessFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(chessVerdict(position, [])).toEqual({ reason: 'stalemate', loser: null });
  });

  it('draws on the third occurrence of a position, counting side to move and rights', () => {
    const shuffle = 'g1f3 g8f6 f3g1 f6g8';
    const twice = play(`${shuffle} ${shuffle}`);
    expect(chessVerdict(twice.position, twice.history)).toEqual({ reason: 'repetition', loser: null });
    const once = play(shuffle);
    expect(chessVerdict(once.position, once.history)).toBeNull();
    // The same placement after a rook move has lost a castling right, so it is not a repeat.
    const rights = play('h2h3 h7h6 h1h2 h8h7 h2h1 h7h8 h1h2 h8h7 h2h1 h7h8');
    expect(chessVerdict(rights.position, rights.history)).toBeNull();
  });

  it('counts an en passant square only when a capture exists', () => {
    const a = play('e2e4').position;
    const b = chessFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const c = { ...b, enPassant: null };
    expect(chessPositionKey(a)).toBe(chessPositionKey(c));
    const capturable = play('e2e4 a7a6 e4e5 d7d5').position;
    expect(chessPositionKey(capturable)).not.toBe(chessPositionKey({ ...capturable, enPassant: null }));
  });

  it('draws after 100 plies without a pawn move or capture', () => {
    const quiet = (halfmove: number): ChessPosition => chessFen(`4k3/8/8/8/8/8/R7/4K3 w - - ${halfmove} 60`);
    expect(CHESS_FIFTY_MOVE_PLIES).toBe(100);
    expect(chessVerdict(quiet(99), [])).toBeNull();
    expect(chessVerdict(quiet(100), [])).toEqual({ reason: 'fifty-move', loser: null });
    // Checkmate on the hundredth ply still wins.
    const mated = chessFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 100 60');
    expect(chessVerdict(mated, [])).toEqual({ reason: 'checkmate', loser: 1 });
  });

  it('resets the clock on a pawn move or capture', () => {
    expect(chessApply(chessFen('4k3/8/8/8/8/8/P7/4K3 w - - 40 1'), chessMoveOf('a2a3')).halfmove).toBe(0);
    expect(chessApply(chessFen('4k3/8/8/8/8/8/R6r/4K3 w - - 40 1'), chessMoveOf('a2h2')).halfmove).toBe(0);
    expect(chessApply(chessFen('4k3/8/8/8/8/8/R7/4K3 w - - 40 1'), chessMoveOf('a2a3')).halfmove).toBe(41);
  });

  it.each([
    ['bare kings', '4k3/8/8/8/8/8/8/4K3', true],
    ['king and bishop against king', '4k3/8/8/8/8/8/8/2B1K3', true],
    ['king and knight against king', '4k3/8/8/8/8/8/8/1N2K3', true],
    ['bishops on the same colour', '3bk3/8/8/8/8/8/8/2B1K3', true],
    ['bishops on opposite colours', '2b1k3/8/8/8/8/8/8/2B1K3', false],
    ['two knights', '4k3/8/8/8/8/8/8/1NN1K3', false],
    ['a pawn', '4k3/8/8/8/8/8/P7/4K3', false],
    ['a rook', '4k3/8/8/8/8/8/8/R3K3', false],
    ['knight against bishop', '4k3/8/8/8/8/8/8/1N2Kb2', false],
  ])('judges %s', (_name, placement, dead) => {
    expect(chessInsufficientMaterial(chessFen(`${placement} w - - 0 1`).board)).toBe(dead);
    if (dead) expect(chessVerdict(chessFen(`${placement} w - - 0 1`), [])).toEqual({ reason: 'insufficient-material', loser: null });
  });

  it('plays random games to a legal end without losing a king', () => {
    const random = lcg(7);
    for (let game = 0; game < 6; game++) {
      let position = START;
      const history: string[] = [];
      for (let ply = 0; ply < 300 && chessVerdict(position, history) === null; ply++) {
        const moves = chessLegalMoves(position);
        expect(moves.length).toBeGreaterThan(0);
        history.push(chessPositionKey(position));
        position = chessApply(position, moves[Math.floor(random() * moves.length)]);
        expect(position.board.filter((cell) => cell === 'K')).toHaveLength(1);
        expect(position.board.filter((cell) => cell === 'k')).toHaveLength(1);
      }
    }
  });
});

describe('chess notation', () => {
  it('writes pawn moves, captures, and en passant', () => {
    expect(san(START, 'e2e4')).toBe('e4');
    expect(san(play('e2e4 d7d5').position, 'e4d5')).toBe('exd5');
    expect(san(play('e2e4 a7a6 e4e5 d7d5').position, 'e5d6')).toBe('exd6');
  });

  it('writes piece moves and captures', () => {
    expect(san(START, 'g1f3')).toBe('Nf3');
    expect(san(play('e2e4 d7d5 g1f3 d5e4').position, 'f3e5')).toBe('Ne5');
    expect(san(play('e2e4 d7d5 d1h5 g8f6').position, 'h5f7')).toBe('Qxf7+');
  });

  it('writes castling', () => {
    expect(san(KIWIPETE, 'e1g1')).toBe('O-O');
    expect(san(KIWIPETE, 'e1c1')).toBe('O-O-O');
    expect(san(chessFen('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1'), 'e8c8')).toBe('O-O-O');
  });

  it('adds check and checkmate marks', () => {
    expect(san(play('f2f3 e7e5 g2g4').position, 'd8h4')).toBe('Qh4#');
    expect(san(chessFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), 'a1a8')).toBe('Ra8+');
  });

  it('writes promotions with their marks', () => {
    const position = chessFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    expect(san(position, 'a7a8q')).toBe('a8=Q');
    expect(san(position, 'a7b8n')).toBe('axb8=N');
    expect(san(chessFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8r')).toBe('a8=R+');
    expect(san(chessFen('7k/P7/8/8/8/8/8/4K3 w - - 0 1'), 'a7a8n')).toBe('a8=N');
    expect(san(chessFen('6k1/5ppp/8/8/8/8/P7/4K3 w - - 0 1'), 'a2a3')).toBe('a3');
    expect(san(chessFen('6k1/P4ppp/8/8/8/8/8/R3K3 w - - 0 1'), 'a7a8q')).toBe('a8=Q#');
  });

  it('disambiguates by file, rank, or both', () => {
    const files = chessFen('4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1');
    expect(san(files, 'c3e4')).toBe('Nce4');
    expect(san(files, 'g3e4')).toBe('Nge4');
    const ranks = chessFen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
    expect(san(ranks, 'a5a3')).toBe('R5a3');
    expect(san(ranks, 'a1a3')).toBe('R1a3');
    const both = chessFen('8/7k/8/Q7/8/8/7K/Q3Q3 w - - 0 1');
    expect(san(both, 'a1c3')).toBe('Qa1c3');
    expect(san(both, 'a5c3')).toBe('Q5c3');
    expect(san(both, 'e1c3')).toBe('Qec3');
  });

  it('ignores a rival that cannot legally move there', () => {
    // The knight on c3 is pinned to the king by the rook, so only the other knight can reach d5.
    const position = chessFen('4r1k1/8/8/8/8/2N1N3/8/4K3 w - - 0 1');
    expect(san(position, 'c3d5')).toBe('Nd5');
  });

  it('exposes facts of the move', () => {
    const facts = chessMoveFacts(play('e2e4 a7a6 e4e5 d7d5').position, chessMoveOf('e5d6'));
    expect(facts).toMatchObject({ piece: 'P', captured: 'p', enPassant: true, san: 'exd6' });
    expect(chessMoveFacts(KIWIPETE, chessMoveOf('e1g1'))).toMatchObject({ piece: 'K', castle: 'k' });
    expect(() => chessMoveFacts(START, chessMoveOf('e2e5'))).toThrow();
  });

  it('keeps SAN consistent with replayed games', () => {
    const moves: ChessMove[] = 'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1'.split(' ').map(chessMoveOf);
    let position = START;
    const notation = moves.map((move) => {
      const text = chessSan(position, move);
      position = chessApply(position, move);
      return text;
    });
    expect(notation.join(' ')).toBe('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O');
  });
});
