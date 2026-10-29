import { describe, expect, it } from 'vitest';
import {
  BQ_CELLS, BQ_DOWN, BQ_EMPTY, BQ_STANDARD_RULES, bqApplyBlind, bqApplyMove, bqBlindTakes, bqCanCapture, bqCell, bqColour, bqFlips, bqFullSet, bqGlyph, bqHasAction,
  bqMoves, bqMovesFrom, bqNode, bqPiece, bqRank, bqTally, isBqBoard,
} from '@shared/rules/banqi';
import type { BqBoard, BqRules } from '@shared/rules/banqi';
import { position } from '../fixtures/banqi-position';

const at = (col: number, row: number): number => row * 8 + col;
const targets = (board: BqBoard, from: number, rules: BqRules = BQ_STANDARD_RULES): number[] =>
  bqMovesFrom(board, from, rules).map((move) => move.to).sort((a, b) => a - b);

describe('Banqi pieces and cells', () => {
  it('has 32 pieces: sixteen per colour with the standard counts', () => {
    const set = bqFullSet();
    expect(set).toHaveLength(32);
    expect(bqTally(set)).toEqual([1, 2, 2, 2, 2, 2, 5, 1, 2, 2, 2, 2, 2, 5]);
    expect(set.filter((piece) => bqColour(piece) === 0)).toHaveLength(16);
    expect([bqGlyph(bqPiece(0, 0)), bqGlyph(bqPiece(1, 0)), bqGlyph(bqPiece(0, 6)), bqGlyph(bqPiece(1, 6))]).toEqual(['帥', '將', '兵', '卒']);
    expect(bqRank(bqPiece(1, 4))).toBe(4);
  });

  it('maps node ids to cells on the 8 × 4 board only', () => {
    expect(bqCell('7,3')).toBe(31);
    expect(bqNode(31)).toBe('7,3');
    for (const bad of ['8,0', '0,4', '-1,0', '0', 5, null]) expect(bqCell(bad)).toBeNull();
    expect(isBqBoard(new Array(BQ_CELLS).fill(BQ_DOWN))).toBe(true);
    expect(isBqBoard(new Array(BQ_CELLS).fill(14))).toBe(false);
    expect(isBqBoard([])).toBe(false);
  });
});

describe('Banqi rank captures', () => {
  const red = (rank: number) => bqPiece(0, rank as never);
  const black = (rank: number) => bqPiece(1, rank as never);

  it('lets a piece take an enemy of equal or lower rank but never a higher one', () => {
    expect(bqCanCapture(red(3), black(3))).toBe(true);
    expect(bqCanCapture(red(3), black(5))).toBe(true);
    expect(bqCanCapture(red(3), black(2))).toBe(false);
    expect(bqCanCapture(red(1), black(0))).toBe(false);
    expect(bqCanCapture(red(0), black(1))).toBe(true);
  });

  it('lets the soldier take the general while the general cannot take a soldier', () => {
    expect(bqCanCapture(red(6), black(0))).toBe(true);
    expect(bqCanCapture(black(6), red(0))).toBe(true);
    expect(bqCanCapture(red(0), black(6))).toBe(false);
    expect(bqCanCapture(red(6), black(1))).toBe(false);
  });

  it('never takes a friendly piece, and the cannon never captures by stepping', () => {
    expect(bqCanCapture(red(3), red(5))).toBe(false);
    expect(bqCanCapture(red(5), black(5))).toBe(false);
  });
});

describe('Banqi moves', () => {
  it('steps one cell orthogonally onto empty cells and captures adjacent lower ranks', () => {
    const board = position(['........', '..R.h...', '........', '........']);
    expect(targets(board, at(2, 1))).toEqual([at(2, 0), at(1, 1), at(3, 1), at(2, 2)].sort((a, b) => a - b));
    const next = position(['........', '..Rh....', '........', '........']);
    expect(bqMovesFrom(next, at(2, 1), BQ_STANDARD_RULES).find((move) => move.to === at(3, 1))).toMatchObject({ capture: true });
  });

  it('does not capture a higher rank, a friend, or a face-down piece, and does not step onto them', () => {
    const board = position(['.k......', '.R#.....', '.r......', '........']);
    // Up is a black general (higher), right is face down, down is a black chariot (equal), left is empty.
    expect(targets(board, at(1, 1))).toEqual([at(0, 1), at(1, 2)]);
    expect(bqMovesFrom(board, at(1, 1), BQ_STANDARD_RULES).find((move) => move.to === at(1, 2))?.capture).toBe(true);
  });

  it('does not let the general capture an adjacent soldier but lets the soldier capture the general', () => {
    expect(targets(position(['Kp......', '........', '........', '........']), at(0, 0))).toEqual([at(0, 1)]);
    expect(targets(position(['Pk......', '........', '........', '........']), at(0, 0))).toEqual([at(1, 0), at(0, 1)]);
  });

  it('keeps pieces on the board edges', () => {
    expect(targets(position(['R.......', '........', '........', '........']), 0)).toEqual([1, 8]);
  });
});

describe('Banqi cannon', () => {
  it('steps one cell onto empty cells but never captures an adjacent piece', () => {
    const board = position(['........', '.Cp.....', '........', '........']);
    expect(bqMovesFrom(board, at(1, 1), BQ_STANDARD_RULES).filter((move) => move.capture)).toEqual([]);
    expect(targets(board, at(1, 1))).toEqual([at(1, 0), at(0, 1), at(1, 2)]);
  });

  it('captures a face-up enemy by jumping exactly one piece of either state at any distance', () => {
    const faceDown = position(['C#.....p', '........', '........', '........']);
    expect(bqMovesFrom(faceDown, 0, BQ_STANDARD_RULES).filter((move) => move.capture)).toEqual([{ from: 0, to: 7, capture: true }]);
    const faceUp = position(['C..P...k', '........', '........', '........']);
    expect(bqMovesFrom(faceUp, 0, BQ_STANDARD_RULES).filter((move) => move.capture)).toEqual([{ from: 0, to: 7, capture: true }]);
  });

  it('captures any rank, including a higher one', () => {
    const board = position(['C.#.k...', '........', '........', '........']);
    expect(bqMovesFrom(board, 0, BQ_STANDARD_RULES).filter((move) => move.capture).map((move) => move.to)).toEqual([4]);
  });

  it('cannot jump two pieces, take a friend, or take a face-down piece', () => {
    expect(bqMovesFrom(position(['C#p.....', '........', '........', '........']), 0, BQ_STANDARD_RULES)
      .filter((move) => move.capture)).toEqual([{ from: 0, to: 2, capture: true }]);
    expect(bqMovesFrom(position(['C#r#p...', '........', '........', '........']), 0, BQ_STANDARD_RULES)
      .filter((move) => move.capture).map((move) => move.to)).toEqual([2]);
    expect(bqMovesFrom(position(['C#P.....', '........', '........', '........']), 0, BQ_STANDARD_RULES)
      .filter((move) => move.capture)).toEqual([]);
    expect(bqMovesFrom(position(['C##.....', '........', '........', '........']), 0, BQ_STANDARD_RULES)
      .filter((move) => move.capture)).toEqual([]);
  });

  it('jumps along columns too', () => {
    const board = position(['C.......', '#.......', 'p.......', '........']);
    expect(bqMovesFrom(board, 0, BQ_STANDARD_RULES).filter((move) => move.capture)).toEqual([{ from: 0, to: at(0, 2), capture: true }]);
  });
});

describe('Banqi chariot dash option', () => {
  const dash: BqRules = { chain: false, rookDash: true, blindCapture: false };

  it('moves one step without the option', () => {
    expect(targets(position(['R.......', '........', '........', '........']), 0)).toEqual([1, 8]);
  });

  it('slides any distance over empty cells and stops before a blocker', () => {
    const board = position(['R..P...#', '........', '........', '........']);
    expect(targets(board, 0, dash)).toEqual([1, 2, 8, 16, 24]);
  });

  it('captures the first piece in line at a distance when it is a face-up enemy it can take', () => {
    const board = position(['R...p...', '........', 'k.......', '........']);
    const moves = bqMovesFrom(board, 0, dash);
    expect(moves.filter((move) => move.capture).map((move) => move.to)).toEqual([4]);
    // The black general down the column outranks the chariot.
    expect(moves.some((move) => move.to === at(0, 2))).toBe(false);
  });

  it('does not slide through a piece, and does not capture a face-down piece', () => {
    const board = position(['R.#.p...', '........', '........', '........']);
    expect(targets(board, 0, dash)).toEqual([1, 8, 16, 24]);
  });

  it('leaves other pieces on one step', () => {
    expect(targets(position(['H.......', '........', '........', '........']), 0, dash)).toEqual([1, 8]);
  });
});

describe('Banqi chain continuation and legal actions', () => {
  it('lists only captures when asked for captures only', () => {
    const board = position(['pR......', '........', '........', '........']);
    expect(bqMovesFrom(board, 1, BQ_STANDARD_RULES).map((move) => move.capture).sort()).toEqual([false, false, true]);
    expect(bqMovesFrom(board, 1, BQ_STANDARD_RULES, true)).toEqual([{ from: 1, to: 0, capture: true }]);
    expect(bqMovesFrom(position(['.R......', '........', '........', '........']), 1, BQ_STANDARD_RULES, true)).toEqual([]);
  });

  it('lists every move of one colour and every flip', () => {
    const board = position(['R#.....p', '........', '........', '#......k']);
    expect(bqFlips(board)).toEqual([1, 24]);
    expect(bqMoves(board, 0, BQ_STANDARD_RULES).map((move) => move.to)).toEqual([8]);
    expect(bqMoves(board, 1, BQ_STANDARD_RULES).length).toBeGreaterThan(0);
  });

  it('counts a flip as an action, and reports none for a walled-in colour with nothing face down', () => {
    expect(bqHasAction(position(['R#......', '........', '........', '........']), 0, BQ_STANDARD_RULES)).toBe(true);
    expect(bqHasAction(position(['KA......', 'A.......', '........', '........']), 0, BQ_STANDARD_RULES)).toBe(true);
    // Red's general and advisors are walled in by black generals, which the advisors cannot take.
    const jammed = position(['KAk.....', 'Ak......', 'k.......', '........']);
    expect(bqHasAction(jammed, 0, BQ_STANDARD_RULES)).toBe(false);
    expect(bqHasAction(jammed, 1, BQ_STANDARD_RULES)).toBe(true);
  });

  it('applies a move without changing the input and reports the captured piece', () => {
    const board = position(['Rp......', '........', '........', '........']);
    const applied = bqApplyMove(board, { from: 0, to: 1, capture: true });
    expect(applied.captured).toBe(bqPiece(1, 6));
    expect(applied.board[1]).toBe(bqPiece(0, 3));
    expect(applied.board[0]).toBe(BQ_EMPTY);
    expect(board[0]).toBe(bqPiece(0, 3));
  });
});

describe('Banqi blind attacks (連吃 on face-down pieces)', () => {
  const blind: BqRules = { chain: true, rookDash: false, blindCapture: true };
  const blindTargets = (board: BqBoard, from: number, rules: BqRules = blind, capturesOnly = false): number[] =>
    bqMovesFrom(board, from, rules, capturesOnly).filter((move) => move.blind).map((move) => move.to).sort((a, b) => a - b);

  it('reaches face-down neighbours with the normal capture geometry, and only with the rule on', () => {
    const board = position(['#R#.....', '.#......', '........', '........']);
    expect(blindTargets(board, 1)).toEqual([0, 2, 9]);
    expect(blindTargets(board, 1, BQ_STANDARD_RULES)).toEqual([]);
    expect(blindTargets(board, 1, { ...blind, blindCapture: false })).toEqual([]);
    // A chain continuation may attack face-down pieces too.
    expect(blindTargets(board, 1, blind, true)).toEqual([0, 2, 9]);
    expect(bqMovesFrom(board, 1, blind).find((move) => move.to === 0)).toEqual({ from: 1, to: 0, capture: false, blind: true });
  });

  it('lets the cannon attack only by jumping, over any screen, and the dashing chariot at a distance', () => {
    expect(blindTargets(position(['C#......', '........', '........', '........']), 0)).toEqual([]);
    expect(blindTargets(position(['C##.....', '........', '........', '........']), 0)).toEqual([2]);
    expect(blindTargets(position(['CP.#....', '........', '........', '........']), 0)).toEqual([3]);
    expect(blindTargets(position(['Cp#.....', '........', '........', '........']), 0)).toEqual([2]);
    expect(blindTargets(position(['R..#....', '........', '........', '........']), 0)).toEqual([]);
    expect(blindTargets(position(['R..#....', '........', '........', '........']), 0, { ...blind, rookDash: true })).toEqual([3]);
  });

  it('takes a revealed enemy the attacker could capture, keeping the soldier and general exceptions', () => {
    const [R, K, P, C] = [bqPiece(0, 3), bqPiece(0, 0), bqPiece(0, 6), bqPiece(0, 5)];
    expect(bqBlindTakes(R, bqPiece(1, 3))).toBe(true);
    expect(bqBlindTakes(R, bqPiece(1, 2))).toBe(false);
    expect(bqBlindTakes(R, bqPiece(0, 6))).toBe(false);
    expect(bqBlindTakes(P, bqPiece(1, 0))).toBe(true);
    expect(bqBlindTakes(K, bqPiece(1, 6))).toBe(false);
    expect(bqBlindTakes(C, bqPiece(1, 0))).toBe(true);
    expect(bqBlindTakes(C, bqPiece(0, 0))).toBe(false);
  });

  it('applies a blind attack without mutating the board: a take moves in, a failure only turns the piece over', () => {
    const board = position(['R#......', '........', '........', '........']);
    const move = { from: 0, to: 1, capture: false, blind: true } as const;
    expect(bqApplyBlind(board, move, bqPiece(1, 6)))
      .toEqual({ board: position(['.R......', '........', '........', '........']), captured: bqPiece(1, 6) });
    expect(bqApplyBlind(board, move, bqPiece(1, 0)))
      .toEqual({ board: position(['Rk......', '........', '........', '........']), captured: null });
    expect(board[1]).toBe(BQ_DOWN);
  });
});
