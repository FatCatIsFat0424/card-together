import { describe, expect, it } from 'vitest';
import {
  chessApply, chessInitialPosition, chessIsLegal, chessKindOf, chessLegalMoves, chessPositionKey, chessSan, chessSideOf,
  chessVerdict,
} from '@shared/rules/chess';
import type { ChessMove, ChessPosition, ChessSide } from '@shared/rules/chess';
import { chessBestMove, chessEasyMove } from '../../src/bots/chess-search';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { chessFen, chessMoveOf } from '../fixtures/chess-positions';

const never = { expired: () => false };
const hard = (position: ChessPosition, maxDepth: number, seed = 1, history: readonly string[] = []): ChessMove | null =>
  chessBestMove(position, position.turn, history, { maxDepth, budget: never, random: seededRandom(seed) });

const KIWIPETE = chessFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');

/** True when the side to move can force checkmate within `moves` of its own moves, whatever the replies. */
function forcesMate(position: ChessPosition, moves: number, search: (p: ChessPosition) => ChessMove | null): boolean {
  const move = search(position);
  if (!move) return false;
  const after = chessApply(position, move);
  const verdict = chessVerdict(after, []);
  if (verdict?.reason === 'checkmate') return true;
  if (verdict !== null || moves <= 1) return false;
  return chessLegalMoves(after).every((reply) => forcesMate(chessApply(after, reply), moves - 1, search));
}

describe('chess hard search', () => {
  it('plays a mate in one', () => {
    const position = chessFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(chessSan(position, hard(position, 1)!)).toBe('Ra8#');
    const mate = chessFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    expect(chessSan(mate, hard(mate, 2)!)).toBe('Qxf7#');
  });

  it('finds forced mates in two', () => {
    for (const fen of [
      '7k/8/5K2/8/8/8/8/R7 w - - 0 1',
      'k7/8/1K6/8/8/8/8/6RR w - - 0 1',
      '6k1/5ppp/8/8/8/8/1Q3PPP/1R4K1 w - - 0 1',
    ]) {
      const position = chessFen(fen);
      expect(forcesMate(position, 2, (current) => hard(current, 4)), fen).toBe(true);
    }
  });

  it('does not hang the queen to a defended pawn or an attacked square', () => {
    const defended = chessFen('4k3/4p3/3p4/8/8/8/8/3QK3 w - - 0 1');
    for (let seed = 1; seed <= 6; seed++) {
      const move = hard(defended, 3, seed)!;
      expect(`${move.from}-${move.to}`).not.toBe(`${3 + 56}-${3 + 16}`);
      const after = chessApply(defended, move);
      const lost = chessLegalMoves(after).some((reply) => after.board[reply.to] === 'Q');
      expect(lost).toBe(false);
    }
  });

  it('takes a free queen', () => {
    const position = chessFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
    expect(chessSan(position, hard(position, 3)!)).toBe('Rxd5');
  });

  it('plays only legal moves and returns null without any', () => {
    const move = hard(KIWIPETE, 3)!;
    expect(chessIsLegal(KIWIPETE, move)).toBe(true);
    const mated = chessFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    expect(hard(mated, 3)).toBeNull();
    expect(chessBestMove(KIWIPETE, 1, [], { maxDepth: 2, budget: never, random: seededRandom(1) })).toBeNull();
  });

  it('respects the time budget', () => {
    const deadline = performance.now() + 150;
    const started = performance.now();
    const move = chessBestMove(KIWIPETE, 0, [], {
      maxDepth: 64, budget: { expired: () => performance.now() >= deadline }, random: seededRandom(3),
    });
    expect(performance.now() - started).toBeLessThan(750);
    expect(move && chessIsLegal(KIWIPETE, move)).toBe(true);
  });

  it('is deterministic per seed when depth-limited', () => {
    const start = chessInitialPosition();
    const first = [1, 2, 3].map((seed) => hard(start, 3, seed));
    expect([1, 2, 3].map((seed) => hard(start, 3, seed))).toEqual(first);
    expect(hard(KIWIPETE, 3, 9)).toEqual(hard(KIWIPETE, 3, 9));
  });

  it('avoids a threefold repetition when winning and seeks it when lost', () => {
    const winning = chessFen('4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
    const shuffle = chessMoveOf('e1d1');
    const twice = [chessPositionKey(chessApply(winning, shuffle)), chessPositionKey(chessApply(winning, shuffle))];
    for (let seed = 1; seed <= 4; seed++) expect(hard(winning, 3, seed, twice)).not.toEqual(shuffle);

    const lost = chessFen('4k3/8/8/8/8/8/8/Q3K3 b - - 0 1');
    const escape = chessMoveOf('e8d8');
    const repeats = [chessPositionKey(chessApply(lost, escape)), chessPositionKey(chessApply(lost, escape))];
    expect(hard(lost, 3, 1, repeats)).toEqual(escape);
  });
});

describe('chess easy search', () => {
  it('takes a mate in one', () => {
    const position = chessFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    expect(chessSan(position, chessEasyMove(position, 0, [], seededRandom(2))!)).toBe('Ra8#');
  });

  it('does not leave its queen to a one-move capture', () => {
    const position = chessFen('4k3/4p3/3p4/8/8/8/8/3QK3 w - - 0 1');
    for (let seed = 1; seed <= 20; seed++) {
      const after = chessApply(position, chessEasyMove(position, 0, [], seededRandom(seed))!);
      expect(chessLegalMoves(after).some((reply) => after.board[reply.to] === 'Q')).toBe(false);
    }
  });

  it('plays legal moves and varies with the seed', () => {
    const start = chessInitialPosition();
    const moves = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const move = chessEasyMove(start, 0, [], seededRandom(seed))!;
      expect(chessIsLegal(start, move)).toBe(true);
      moves.add(`${move.from}-${move.to}`);
    }
    expect(moves.size).toBeGreaterThan(1);
    expect(chessEasyMove(start, 1, [], seededRandom(1))).toBeNull();
  });
});

describe('chess hard against easy', () => {
  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const PLY_LIMIT = 100;

  /** The material lead of `side`, in pawns. */
  function lead(position: ChessPosition, side: ChessSide): number {
    let total = 0;
    for (const cell of position.board) {
      if (cell) total += (chessSideOf(cell) === side ? 1 : -1) * PIECE_VALUE[chessKindOf(cell)];
    }
    return total;
  }

  /** Plays one game; the winner is the checkmating side, or at the ply limit the side ahead by at least three pawns. */
  function playGame(hardSide: ChessSide, seed: number): 'hard' | 'easy' | 'draw' {
    const random = seededRandom(seed);
    let position = chessInitialPosition();
    const history: string[] = [];
    for (let ply = 0; ply < PLY_LIMIT; ply++) {
      const verdict = chessVerdict(position, history);
      if (verdict) return verdict.loser === null ? 'draw' : verdict.loser === hardSide ? 'easy' : 'hard';
      const move = position.turn === hardSide
        ? chessBestMove(position, position.turn, history, { maxDepth: 3, budget: never, random })
        : chessEasyMove(position, position.turn, history, random);
      history.push(chessPositionKey(position));
      position = chessApply(position, move!);
    }
    const margin = lead(position, hardSide);
    return margin >= 3 ? 'hard' : margin <= -3 ? 'easy' : 'draw';
  }

  it('wins at least eight of ten seeded games', () => {
    const results = Array.from({ length: 10 }, (_, game) => playGame(game % 2 === 0 ? 0 : 1, 100 + game));
    expect(results.filter((result) => result === 'hard').length, results.join(',')).toBeGreaterThanOrEqual(8);
  }, 60_000);
});
