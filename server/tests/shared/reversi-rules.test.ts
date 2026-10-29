import { describe, expect, it } from 'vitest';
import { coordinateLabel } from '@shared/rules/board/board-model';
import { reversiBoard } from '@shared/rules/board/boards';
import {
  RV_CELLS, isRvDiscs, rvCell, rvCounts, rvFlips, rvIndex, rvInitialDiscs, rvLeader, rvLegalMoves, rvNextSide, rvNode,
  rvPlace,
} from '@shared/rules/reversi';
import type { RvCell, RvDiscs } from '@shared/rules/reversi';

/** Builds a position from eight rows of `.`, `x` (dark), and `o` (light), top row first. */
function position(rows: readonly string[]): RvDiscs {
  return rows.join('').split('').map((char): RvCell => (char === 'x' ? 0 : char === 'o' ? 1 : null));
}

const label = (index: number): string => coordinateLabel(reversiBoard(), rvNode(index));

describe('Reversi start and legal moves', () => {
  it('starts with d4 and e5 light, e4 and d5 dark', () => {
    const discs = rvInitialDiscs();
    expect([label(rvIndex(3, 4)), discs[rvIndex(3, 4)]]).toEqual(['d4', 1]);
    expect([label(rvIndex(4, 4)), discs[rvIndex(4, 4)]]).toEqual(['e4', 0]);
    expect([label(rvIndex(3, 3)), discs[rvIndex(3, 3)]]).toEqual(['d5', 0]);
    expect([label(rvIndex(4, 3)), discs[rvIndex(4, 3)]]).toEqual(['e5', 1]);
    expect(rvCounts(discs)).toEqual([2, 2]);
  });

  it('gives each side the four standard opening moves', () => {
    const discs = rvInitialDiscs();
    expect(rvLegalMoves(discs, 0).map(label).sort()).toEqual(['c4', 'd3', 'e6', 'f5']);
    expect(rvLegalMoves(discs, 1).map(label).sort()).toEqual(['c5', 'd6', 'e3', 'f4']);
  });

  it('flips the bracketed discs in every direction at once and nothing else', () => {
    const discs = position([
      '........',
      '.x.x.x..',
      '..ooo...',
      '.xo.ox..',
      '..ooo...',
      '.x.x.x..',
      '........',
      '........',
    ]);
    const centre = rvIndex(3, 3);
    const placed = rvPlace(discs, centre, 0);
    expect(placed?.flips).toHaveLength(8);
    expect(placed?.flips.every((index) => discs[index] === 1 && placed.discs[index] === 0)).toBe(true);
    expect(rvCounts(placed!.discs)).toEqual([8 + 1 + 8, 0]);
    // Light has nothing bracketed from that cell, so the same cell is not legal for it.
    expect(rvFlips(discs, centre, 1)).toEqual([]);
  });

  it('rejects occupied cells, cells that flip nothing, and indices off the board', () => {
    const discs = rvInitialDiscs();
    expect(rvFlips(discs, rvIndex(3, 3), 0)).toEqual([]);
    expect(rvPlace(discs, rvIndex(0, 0), 0)).toBeNull();
    expect(rvPlace(discs, -1, 0)).toBeNull();
    expect(rvPlace(discs, RV_CELLS, 0)).toBeNull();
    expect(rvPlace(discs, 1.5, 0)).toBeNull();
  });

  it('does not wrap flips around the board edge', () => {
    const discs = position([
      '........',
      '........',
      '........',
      '.......o',
      'x.......',
      '........',
      '........',
      '........',
    ]);
    expect(rvFlips(discs, rvIndex(6, 3), 0)).toEqual([]);
  });

  it('leaves the caller position untouched', () => {
    const discs = rvInitialDiscs();
    const copy = [...discs];
    rvPlace(discs, rvIndex(3, 2), 0);
    expect(discs).toEqual(copy);
  });
});

describe('Reversi turns, passes, and the end', () => {
  it('hands the turn to the opponent, or back to the mover when the opponent is stuck', () => {
    expect(rvNextSide(rvInitialDiscs(), 0)).toBe(1);
    const stuck = position([
      'xo......',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '......ox',
    ]);
    // Light cannot move anywhere, but dark can capture a1-b1.
    expect(rvNextSide(stuck, 0)).toBe(0);
  });

  it('ends the game when neither side can move', () => {
    const over = position([
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxx',
      'xxxxxxxo',
    ]);
    expect(rvNextSide(over, 0)).toBeNull();
    expect(rvLeader(over)).toBe(0);
    expect(rvCounts(over)).toEqual([63, 1]);
  });

  it('calls equal counts a tie', () => {
    expect(rvLeader(rvInitialDiscs())).toBeNull();
  });
});

describe('Reversi cell ids', () => {
  it('maps cells to board nodes and back', () => {
    for (let index = 0; index < RV_CELLS; index++) expect(rvCell(rvNode(index))).toBe(index);
    expect(rvNode(rvIndex(3, 2))).toBe('3,2');
    expect(['8,0', '0,8', '-1,0', '3', 3, null, undefined, '01,2', '3,2 ']).toSatisfy(
      (values: unknown[]) => values.every((value) => rvCell(value) === null));
  });

  it('checks the shape of a stored position', () => {
    expect(isRvDiscs(rvInitialDiscs())).toBe(true);
    expect(isRvDiscs(rvInitialDiscs().slice(1))).toBe(false);
    expect(isRvDiscs(rvInitialDiscs().map(() => 2))).toBe(false);
  });
});
