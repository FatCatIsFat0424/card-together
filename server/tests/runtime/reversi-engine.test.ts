import { describe, expect, it } from 'vitest';
import { rvCounts, rvFlips, rvInitialDiscs, rvLegalMoves, rvNextSide, rvPlace } from '@shared/rules/reversi';
import type { RvDiscs, RvSide } from '@shared/rules/reversi';
import { cellsOf, flips, fromDiscs, moves, out, transform } from '../../src/bots/reversi-board';
import type { Bitboards } from '../../src/bots/reversi-board';
import { REVERSI_BOOK_PATH, canonicalBoard, bookMove, parseBook } from '../../src/bots/reversi-book';
import { emptiesOf, rootMoves, searchPosition, searchScore, solveExact } from '../../src/bots/reversi-engine';
import { FEATURE_COUNT, SCALE, evaluate, evaluationWeights, featureIndices } from '../../src/bots/reversi-eval';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { readFileSync } from 'node:fs';

const other = (side: RvSide): RvSide => (side === 0 ? 1 : 0);

/** Positions along seeded random games, each with the side to move (which has a legal move). */
function randomPositions(games: number, seed: number): { discs: RvDiscs; side: RvSide }[] {
  const random = seededRandom(seed);
  const positions: { discs: RvDiscs; side: RvSide }[] = [];
  for (let game = 0; game < games; game++) {
    let discs = rvInitialDiscs();
    let side: RvSide | null = 0;
    while (side !== null) {
      positions.push({ discs, side });
      const legal = rvLegalMoves(discs, side);
      discs = rvPlace(discs, legal[Math.floor(random() * legal.length)], side)!.discs;
      side = rvNextSide(discs, side);
    }
  }
  return positions;
}

/** Leaf count of the game tree with the shared rules, a pass counting as a move. */
function perftRules(discs: RvDiscs, side: RvSide, depth: number): number {
  if (depth === 0) return 1;
  const legal = rvLegalMoves(discs, side);
  if (legal.length === 0) {
    return rvLegalMoves(discs, other(side)).length === 0 ? 1 : perftRules(discs, other(side), depth - 1);
  }
  return legal.reduce((sum, move) => sum + perftRules(rvPlace(discs, move, side)!.discs, other(side), depth - 1), 0);
}

function perftBits(board: Bitboards, depth: number): number {
  if (depth === 0) return 1;
  const children = rootMoves(board);
  if (children.length === 0) {
    const passed = { pl: board.ol, ph: board.oh, ol: board.pl, oh: board.ph };
    return rootMoves(passed).length === 0 ? 1 : perftBits(passed, depth - 1);
  }
  return children.reduce((sum, child) => sum + perftBits(child, depth - 1), 0);
}

/** Exact final disc difference for the side to move by plain minimax over the shared rules. */
function bruteForce(discs: RvDiscs, side: RvSide): number {
  const legal = rvLegalMoves(discs, side);
  if (legal.length === 0) {
    if (rvLegalMoves(discs, other(side)).length === 0) {
      const [dark, light] = rvCounts(discs);
      return side === 0 ? dark - light : light - dark;
    }
    return -bruteForce(discs, other(side));
  }
  return Math.max(...legal.map((move) => -bruteForce(rvPlace(discs, move, side)!.discs, other(side))));
}

const clockFree = { expired: () => false, clock: null, tableBits: 14 } as const;

describe('Reversi bitboards', () => {
  it('count the same game tree as the shared rules', () => {
    const start = rvInitialDiscs();
    // Known perft values of the standard opening.
    expect([1, 2, 3, 4, 5, 6].map((depth) => perftBits(fromDiscs(start, 0), depth))).toEqual([4, 12, 56, 244, 1396, 8200]);
    const random = seededRandom(11);
    for (const { discs, side } of randomPositions(4, 3).filter(() => random() < 0.15)) {
      expect(perftBits(fromDiscs(discs, side), 3)).toBe(perftRules(discs, side, 3));
    }
  });

  it('generate the legal moves and flips of the shared rules', () => {
    for (const { discs, side } of randomPositions(60, 5)) {
      const { pl, ph, ol, oh } = fromDiscs(discs, side);
      moves(pl, ph, ol, oh);
      const legal = rvLegalMoves(discs, side);
      expect(cellsOf(out.lo, out.hi)).toEqual(legal);
      for (const move of legal) {
        flips(move, pl, ph, ol, oh);
        expect(cellsOf(out.lo, out.hi)).toEqual([...rvFlips(discs, move, side)].sort((a, b) => a - b));
      }
    }
  });
});

describe('Reversi endgame solver', () => {
  it('matches brute force on positions with few empty squares', () => {
    const positions = randomPositions(40, 7).filter(({ discs }) => {
      const empties = discs.filter((cell) => cell === null).length;
      return empties >= 5 && empties <= 7;
    });
    expect(positions.length).toBeGreaterThan(30);
    for (const { discs, side } of positions.slice(0, 30)) {
      expect(solveExact(fromDiscs(discs, side))).toBe(bruteForce(discs, side));
    }
  });

  it('agrees with a full-depth midgame search where the transposition table is in use', () => {
    const positions = randomPositions(12, 21).filter(({ discs }) => discs.filter((cell) => cell === null).length === 12);
    expect(positions.length).toBeGreaterThan(5);
    for (const { discs, side } of positions.slice(0, 6)) {
      const board = fromDiscs(discs, side);
      // Adding zero turns a negated -0 into 0.
      expect(searchScore(board, 60) + 0).toBe(solveExact(board) * SCALE + 0);
    }
  });

  it('picks a move that keeps the best proven result', () => {
    const positions = randomPositions(30, 9).filter(({ discs }) => discs.filter((cell) => cell === null).length === 7);
    expect(positions.length).toBeGreaterThan(10);
    for (const { discs, side } of positions.slice(0, 12)) {
      const legal = rvLegalMoves(discs, side);
      const values = new Map(legal.map((move) => [move, -bruteForce(rvPlace(discs, move, side)!.discs, other(side))]));
      const best = Math.sign(Math.max(...values.values()));
      const result = searchPosition(fromDiscs(discs, side), { ...clockFree, maxDepth: 2, solveEmpties: 10 });
      if (legal.length > 1) expect(result.solved).toBe(true);
      // A win or draw must be kept; when every move loses, any move is acceptable.
      if (best >= 0) expect(Math.sign(values.get(result.move)!)).toBe(best);
    }
  });
});

describe('Reversi search', () => {
  it('stops at its deadline with a legal move', () => {
    const { discs, side } = randomPositions(1, 13)[20];
    const started = performance.now();
    const deadline = started + 150;
    const result = searchPosition(fromDiscs(discs, side), {
      maxDepth: 60, expired: () => performance.now() >= deadline, clock: null, solveEmpties: 0, tableBits: 14,
    });
    expect(performance.now() - started).toBeLessThan(400);
    expect(rvLegalMoves(discs, side)).toContain(result.move);
    expect(result.depth).toBeGreaterThan(2);
  });

  it('scores symmetric positions alike and stays inside the solved range', () => {
    for (const { discs, side } of randomPositions(10, 17).filter((_, index) => index % 5 === 0)) {
      const board = fromDiscs(discs, side);
      const empties = emptiesOf(board);
      const score = evaluate(board.pl, board.ph, board.ol, board.oh, empties);
      expect(Math.abs(score)).toBeLessThan(64 * SCALE);
      for (let symmetry = 1; symmetry < 8; symmetry++) {
        const image = transform(board, symmetry);
        expect(evaluate(image.pl, image.ph, image.ol, image.oh, empties)).toBe(score);
      }
    }
  });

  it('loads weights for every feature', () => {
    expect(evaluationWeights().length).toBeGreaterThan(0);
    const indices = new Int32Array(FEATURE_COUNT);
    const board = fromDiscs(rvInitialDiscs(), 0);
    featureIndices(board.pl, board.ph, board.ol, board.oh, indices);
    expect(indices.every((index) => index >= 0)).toBe(true);
  });
});

describe('Reversi opening book', () => {
  it('stores legal moves that every mirror image finds', () => {
    const book = parseBook(readFileSync(REVERSI_BOOK_PATH));
    const count = book.moves.length;
    expect(count).toBeGreaterThan(10);
    const childAfter = (board: Bitboards, move: number): Bitboards => {
      const child = rootMoves(board).find((candidate) => candidate.move === move);
      expect(child).toBeDefined();
      return canonicalBoard(child!).board;
    };
    for (let entry = 0; entry < count; entry += Math.max(1, Math.floor(count / 50))) {
      const board = { pl: book.keys[entry * 4], ph: book.keys[entry * 4 + 1], ol: book.keys[entry * 4 + 2], oh: book.keys[entry * 4 + 3] };
      expect(canonicalBoard(board).board).toEqual(board);
      const expected = childAfter(board, book.moves[entry]);
      // Every mirror image plays the mirrored move (or an equivalent one when the position is symmetric).
      for (let symmetry = 0; symmetry < 8; symmetry++) {
        const image = transform(board, symmetry);
        expect(childAfter(image, bookMove(image))).toEqual(expected);
      }
    }
  });

  it('answers the opening position', () => {
    expect(rvLegalMoves(rvInitialDiscs(), 0)).toContain(bookMove(fromDiscs(rvInitialDiscs(), 0)));
  });
});
