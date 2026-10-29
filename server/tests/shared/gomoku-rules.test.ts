import { describe, expect, it } from 'vitest';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { gomokuBoard } from '@shared/rules/board/boards';
import {
  DEFAULT_GOMOKU_OPTIONS, GM_CELLS, gmBlackSeat, gmCell, gmForbidden, gmHasMove, gmInitialStones, gmIsLegal, gmLegalMoves,
  gmNode, gmPlacements, gmSeatToAct, gmShape, gmSideOfStone, gmStage, gmWinningLine, gmWins, isGmStones, isGomokuOptions,
} from '@shared/rules/gomoku';
import type { GmCell, GomokuOptions } from '@shared/rules/gomoku';

/** Chess-style coordinate (`h8`) to the intersection index; rank 15 is the top row. */
function at(name: string): number {
  const col = name.charCodeAt(0) - 97;
  const row = 15 - Number(name.slice(1));
  return row * 15 + col;
}

function board(black: string, white = ''): GmCell[] {
  const stones = gmInitialStones();
  for (const name of black.split(' ').filter(Boolean)) stones[at(name)] = 0;
  for (const name of white.split(' ').filter(Boolean)) stones[at(name)] = 1;
  return stones;
}

describe('Gomoku coordinates', () => {
  it('maps node ids to intersections and back, matching the shared board and chess-style labels', () => {
    const nodes = gomokuBoard().nodes;
    expect(nodes).toHaveLength(GM_CELLS);
    for (const node of nodes) expect(gmNode(gmCell(node.id)!)).toBe(node.id);
    expect(gmNode(at('h8'))).toBe('7,7');
    expect(coordinateLabel(gomokuBoard(), gmNode(at('a1')))).toBe('a1');
    expect(coordinateLabel(gomokuBoard(), gmNode(at('o15')))).toBe('o15');
  });

  it('rejects ids outside the 15 by 15 grid', () => {
    for (const bad of ['15,0', '0,15', '-1,3', 'a1', '3', 7, null, undefined, '01,2', '1,2,3']) expect(gmCell(bad)).toBeNull();
    expect(gmCell('14,14')).toBe(224);
  });

  it('validates stored grids and room options strictly', () => {
    expect(isGmStones(gmInitialStones())).toBe(true);
    expect(isGmStones(gmInitialStones().slice(1))).toBe(false);
    expect(isGmStones(gmInitialStones().map(() => 2))).toBe(false);
    expect(isGomokuOptions({ renju: true, swap: false })).toBe(true);
    expect(isGomokuOptions({ renju: true })).toBe(false);
    expect(isGomokuOptions({ renju: true, swap: false, extra: 1 })).toBe(false);
    expect(isGomokuOptions({ renju: 1, swap: false })).toBe(false);
    expect(isGomokuOptions(null)).toBe(false);
    expect(DEFAULT_GOMOKU_OPTIONS).toEqual({ renju: false, swap: false });
  });
});

describe('Gomoku winning lines', () => {
  it.each([
    ['across', 'f8 g8 h8 j8', 'i8'],
    ['down', 'h4 h5 h6 h8', 'h7'],
    ['diagonal', 'f6 g7 i9 j10', 'h8'],
    ['anti-diagonal', 'f10 g9 i7 j6', 'h8'],
  ])('wins with five %s', (_name, stones, move) => {
    const position = board(stones);
    expect(gmWins(position, at(move), 0, false)).toBe(true);
    expect(gmWins(position, at(move), 1, false)).toBe(false);
    expect(gmWinningLine(position, at(move), 0, false)).toHaveLength(5);
  });

  it('needs five: four stones do not win, and a broken row does not count', () => {
    expect(gmWins(board('f8 g8 h8'), at('i8'), 0, false)).toBe(false);
    expect(gmWins(board('f8 g8 j8 k8'), at('i8'), 0, false)).toBe(false);
    expect(gmWins(board('f8 g8 h8 i8', 'j8'), at('e8'), 0, false)).toBe(true);
  });

  it('wins on the board edge', () => {
    expect(gmWins(board('a1 a2 a3 a4'), at('a5'), 0, false)).toBe(true);
    expect(gmWins(board('k15 l15 m15 n15'), at('o15'), 0, false)).toBe(true);
    expect(gmWins(board('m13 n14', 'l12'), at('o15'), 0, false)).toBe(false);
  });

  it('counts an overline as a win in free-style play for both colours', () => {
    expect(gmWins(board('e8 f8 g8 i8 j8'), at('h8'), 0, false)).toBe(true);
    expect(gmWins(board('', 'e8 f8 g8 i8 j8'), at('h8'), 1, false)).toBe(true);
  });

  it('lists the whole winning line, including stones beyond five', () => {
    expect(gmWinningLine(board('e8 f8 g8 i8 j8'), at('h8'), 0, false).sort((a, b) => a - b))
      .toEqual(['e8', 'f8', 'g8', 'h8', 'i8', 'j8'].map(at).sort((a, b) => a - b));
    expect(gmWinningLine(board('f8 g8 h8'), at('i8'), 0, false)).toEqual([]);
  });
});

describe('Renju forbidden moves', () => {
  it('forbids an overline for black but lets white win with six', () => {
    const position = board('e8 f8 g8 i8 j8', 'e9 e10 e11');
    expect(gmForbidden(position, at('h8'))).toBe(true);
    expect(gmWins(position, at('h8'), 0, true)).toBe(false);
    expect(gmIsLegal(position, at('h8'), 0, true)).toBe(false);
    expect(gmIsLegal(position, at('h8'), 0, false)).toBe(true);
    const white = board('e9 e10 e11', 'e8 f8 g8 i8 j8');
    expect(gmWins(white, at('h8'), 1, true)).toBe(true);
    expect(gmIsLegal(white, at('h8'), 1, true)).toBe(true);
  });

  it('wins for black only with exactly five', () => {
    expect(gmWins(board('f8 g8 h8 i8'), at('j8'), 0, true)).toBe(true);
    expect(gmWins(board('e8 f8 g8 h8 j8'), at('i8'), 0, true)).toBe(false);
  });

  it('forbids a double three', () => {
    // h8 would make open threes across (f8 g8 h8) and down (h8 h9 h10).
    const position = board('f8 g8 h9 h10');
    expect(gmShape(position, at('h8'), 0, true)).toMatchObject({ threes: 2, fours: 0 });
    expect(gmForbidden(position, at('h8'))).toBe(true);
    // White may make it freely.
    expect(gmIsLegal(board('', 'f8 g8 h9 h10'), at('h8'), 1, true)).toBe(true);
    expect(gmIsLegal(position, at('h8'), 0, false)).toBe(true);
  });

  it('counts a split three, and forbids it together with another three', () => {
    // f8 g8 _ i8 is a split three; h8 completes it to a four, so use h9 h10 and the move g8 instead.
    const position = board('f8 h8 i9 i10');
    expect(gmShape(position, at('g8'), 0, true)).toMatchObject({ threes: 1 });
    const double = board('f8 h8 g9 g10');
    expect(gmShape(double, at('g8'), 0, true)).toMatchObject({ threes: 2 });
    expect(gmForbidden(double, at('g8'))).toBe(true);
  });

  it('forbids a double four, counting a straight four once', () => {
    // i8 makes a four across (f8 g8 h8 i8) and a four down (i8 i9 i10 i11).
    const position = board('f8 g8 h8 i9 i10 i11');
    expect(gmShape(position, at('i8'), 0, true)).toMatchObject({ fours: 2 });
    expect(gmForbidden(position, at('i8'))).toBe(true);
    // A straight four alone (two ways to five) is one four, not a double.
    const straight = board('f8 g8 h8');
    expect(gmShape(straight, at('i8'), 0, true)).toMatchObject({ fours: 1, threes: 0 });
    expect(gmForbidden(straight, at('i8'))).toBe(false);
    // One line with two separate gaps is a double four: b8 c8 _ e8 f8 _ h8 i8 completes at d8 or g8.
    const gaps = board('b8 c8 e8 h8 i8');
    expect(gmShape(gaps, at('f8'), 0, true)).toMatchObject({ fours: 2, five: false });
    expect(gmForbidden(gaps, at('f8'))).toBe(true);
  });

  it('allows four-three, a lone three, and a three blocked on one side', () => {
    // h8 makes a four across (e8 f8 g8 h8, d8 blocked) and an open three down.
    const fourThree = board('e8 f8 g8 h9 h10', 'd8');
    expect(gmShape(fourThree, at('h8'), 0, true)).toMatchObject({ fours: 1, threes: 1 });
    expect(gmForbidden(fourThree, at('h8'))).toBe(false);
    expect(gmForbidden(board('f8 g8 h9 h10', ''), at('k4'))).toBe(false);
    // A three that already has a white stone beside it cannot become a straight four.
    const blocked = board('f8 g8 h9 h10', 'e8 d8');
    expect(gmShape(blocked, at('h8'), 0, true).threes).toBe(1);
    expect(gmForbidden(blocked, at('h8'))).toBe(false);
  });

  it('does not treat a three against the board edge as open', () => {
    // The row a8 b8 c8 cannot become a straight four: there is no room left of a8.
    const edge = board('a8 b8 c9 c10');
    expect(gmShape(edge, at('c8'), 0, true).threes).toBe(1);
    expect(gmForbidden(edge, at('c8'))).toBe(false);
  });

  it('lets exactly five win even when it also makes a double three', () => {
    // h8 completes d8..h8, plus an open three down and another along the diagonal.
    const position = board('d8 e8 f8 g8 h9 h10 i9 j10');
    expect(gmShape(position, at('h8'), 0, true)).toMatchObject({ five: true, threes: 2 });
    expect(gmForbidden(position, at('h8'))).toBe(false);
    expect(gmWins(position, at('h8'), 0, true)).toBe(true);
  });

  it('does not count a three whose open four black could not legally play', () => {
    // Playing h8 makes the open three f8 g8 h8, but both ways to extend it (e8 and i8) would be double fours.
    const trap = 'e9 e10 e11 i9 i10 i11';
    const trapped = board(`f8 g8 h9 h10 ${trap}`);
    const placed = board(`f8 g8 h8 h9 h10 ${trap}`);
    expect(gmForbidden(placed, at('e8'))).toBe(true);
    expect(gmForbidden(placed, at('i8'))).toBe(true);
    expect(gmShape(trapped, at('h8'), 0, false).threes).toBe(2);
    expect(gmShape(trapped, at('h8'), 0, true).threes).toBe(1);
    expect(gmForbidden(trapped, at('h8'))).toBe(false);
    // Without the trap the same stone is an ordinary double three.
    expect(gmForbidden(board('f8 g8 h9 h10'), at('h8'))).toBe(true);
  });

  it('lists only legal moves and keeps the grid untouched', () => {
    const position = board('f8 g8 h9 h10');
    const before = [...position];
    const legal = gmLegalMoves(position, 0, true);
    expect(legal).not.toContain(at('h8'));
    expect(legal).toContain(at('a1'));
    expect(gmLegalMoves(position, 0, false)).toContain(at('h8'));
    expect(gmLegalMoves(position, 1, true)).toContain(at('h8'));
    expect(position).toEqual(before);
    expect(gmHasMove(position, 0, true)).toBe(true);
  });

  it('has no move on a full board', () => {
    const full = gmInitialStones().map((_, index) => (index % 2) as 0 | 1);
    expect(gmHasMove(full, 0, false)).toBe(false);
    expect(gmHasMove(full, 1, true)).toBe(false);
    expect(gmLegalMoves(full, 0, true)).toEqual([]);
  });
});

describe('Gomoku swap opening flow', () => {
  const seats = ['N', 'S'];
  const swapOptions: GomokuOptions = { renju: false, swap: true };
  const place = (n: number) => Array.from({ length: n }, (_, index) => ({ to: `${index},0` }));

  it('puts the first seat on the opening stones, then the second seat on the colour choice', () => {
    expect([0, 1, 2].map((n) => gmStage(swapOptions, place(n)))).toEqual(['placing', 'placing', 'placing']);
    expect([0, 1, 2].map((n) => gmSeatToAct(seats, swapOptions, place(n)))).toEqual(['N', 'N', 'N']);
    expect(gmStage(swapOptions, place(3))).toBe('choosing');
    expect(gmSeatToAct(seats, swapOptions, place(3))).toBe('S');
  });

  it('gives white the next move, and black to the second seat only after a swap', () => {
    const kept = [...place(3), { swap: false }];
    const swapped = [...place(3), { swap: true }];
    expect(gmStage(swapOptions, kept)).toBe('playing');
    expect(gmBlackSeat(seats, kept)).toBe('N');
    expect(gmSeatToAct(seats, swapOptions, kept)).toBe('S');
    expect(gmBlackSeat(seats, swapped)).toBe('S');
    expect(gmSeatToAct(seats, swapOptions, swapped)).toBe('N');
    expect(gmSeatToAct(seats, swapOptions, [...swapped, ...place(1)].slice(0, 5))).toBe('S');
    expect(gmPlacements(swapped)).toBe(3);
  });

  it('alternates colours by stone count regardless of who holds them', () => {
    expect([0, 1, 2, 3, 4].map(gmSideOfStone)).toEqual([0, 1, 0, 1, 0]);
  });

  it('ignores the swap rule when the option is off', () => {
    expect(gmStage(DEFAULT_GOMOKU_OPTIONS, place(3))).toBe('playing');
    expect(gmSeatToAct(seats, DEFAULT_GOMOKU_OPTIONS, place(3))).toBe('S');
    expect(gmSeatToAct(seats, DEFAULT_GOMOKU_OPTIONS, place(0))).toBe('N');
  });
});
