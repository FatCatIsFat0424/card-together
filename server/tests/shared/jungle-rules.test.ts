import { describe, expect, it } from 'vitest';
import {
  JG_CELLS, JG_NO_CAPTURE_LIMIT, isJgCells, jgApply, jgBoardOutcome, jgCanCapture, jgCell, jgDenCell, jgHasMove, jgIndex,
  jgInitialCells, jgIsLegal, jgIsWater, jgLegalMoves, jgNode, jgOutcome, jgPieceCount, jgQuietPlies, jgRankOf, jgSideOf,
  jgTargets, jgTrapped,
} from '@shared/rules/jungle';

/**
 * A position from nine rows of seven characters, top row first: `.` empty, `1`-`8` the ranks of the first side
 * (red, bottom), `a`-`h` the ranks of the second side (blue, top).
 */
function position(rows: readonly string[]): number[] {
  const cells = rows.join('').split('').map((char) => (char === '.' ? 0 : /\d/.test(char) ? Number(char) : char.charCodeAt(0) - 96 + 8));
  expect(cells).toHaveLength(JG_CELLS);
  return cells;
}

const EMPTY = ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'];

/** An empty board with the given pieces placed at `[col, row, char]`. */
function with_(...pieces: readonly [number, number, string][]): number[] {
  const rows = EMPTY.map((row) => row.split(''));
  for (const [col, row, char] of pieces) rows[row][col] = char;
  return position(rows.map((row) => row.join('')));
}

const targets = (cells: number[], col: number, row: number): string[] =>
  jgTargets(cells, jgIndex(col, row)).map(jgNode).sort();

describe('Jungle start position', () => {
  const cells = jgInitialCells();

  it('gives each side one of every animal, mirrored through the board centre', () => {
    expect(isJgCells(cells)).toBe(true);
    for (const side of [0, 1] as const) {
      const ranks = cells.filter((cell) => cell !== 0 && jgSideOf(cell) === side).map(jgRankOf).sort();
      expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
    cells.forEach((cell, index) => {
      if (cell !== 0) expect(cells[JG_CELLS - 1 - index]).toBe(jgRankOf(cell) + (jgSideOf(cell) === 0 ? 8 : 0));
    });
  });

  it('starts every piece on dry land outside the traps', () => {
    cells.forEach((cell, index) => {
      if (cell === 0) return;
      expect(jgIsWater(index)).toBe(false);
      expect(jgTrapped(index, jgSideOf(cell))).toBe(false);
    });
  });

  it('puts the lions and tigers in the corners and the elephants on the right edge of row 2', () => {
    expect([cells[jgIndex(0, 0)], cells[jgIndex(6, 0)], cells[jgIndex(6, 2)], cells[jgIndex(0, 2)]]).toEqual([15, 14, 16, 9]);
    expect([cells[jgIndex(6, 8)], cells[jgIndex(0, 8)], cells[jgIndex(0, 6)], cells[jgIndex(6, 6)]]).toEqual([7, 6, 8, 1]);
  });

  it('opens with the side to move having legal moves and no capture available', () => {
    const moves = jgLegalMoves(cells, 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.some((move) => cells[move.to] !== 0)).toBe(false);
  });
});

describe('Jungle steps', () => {
  it('moves one step in each direction and stays on the board', () => {
    expect(targets(with_([0, 0, '4']), 0, 0)).toEqual(['0,1', '1,0']);
    expect(targets(with_([3, 6, '4']), 3, 6)).toEqual(['2,6', '3,5', '3,7', '4,6']);
  });

  it('keeps every animal but the rat out of the river', () => {
    const near = with_([0, 4, '5']);
    expect(targets(near, 0, 4)).toEqual(['0,3', '0,5']);
    const rat = with_([0, 4, '1']);
    expect(targets(rat, 0, 4)).toEqual(['0,3', '0,5', '1,4']);
  });

  it('never lets a piece enter its own den but lets it enter the opponent’s', () => {
    expect(targets(with_([2, 8, '4']), 2, 8)).toEqual(['1,8', '2,7']);
    expect(targets(with_([3, 7, '4']), 3, 7)).toEqual(['2,7', '3,6', '4,7']);
    expect(targets(with_([3, 1, '4']), 3, 1)).toContain('3,0');
    expect(targets(with_([3, 1, 'd']), 3, 1)).toEqual(['2,1', '3,2', '4,1']);
  });

  it('blocks a move onto a friendly piece', () => {
    expect(targets(with_([0, 0, '4'], [1, 0, '2']), 0, 0)).toEqual(['0,1']);
  });
});

describe('Jungle captures', () => {
  const duel = (attacker: string, target: string): boolean =>
    jgCanCapture(with_([0, 0, attacker], [1, 0, target]), jgIndex(0, 0), jgIndex(1, 0));

  it('takes an equal or lower rank and never a higher one', () => {
    expect(duel('4', 'd')).toBe(true);
    expect(duel('4', 'c')).toBe(true);
    expect(duel('4', 'e')).toBe(false);
    expect(duel('7', 'f')).toBe(true);
    expect(duel('6', 'g')).toBe(false);
    expect(duel('2', 'a')).toBe(true);
    expect(duel('1', 'b')).toBe(false);
  });

  it('lets the rat take the elephant and keeps the elephant from taking the rat', () => {
    expect(duel('1', 'h')).toBe(true);
    expect(duel('8', 'a')).toBe(false);
    expect(duel('8', 'g')).toBe(true);
    expect(duel('1', 'g')).toBe(false);
  });

  it('never takes a friendly piece or an empty cell', () => {
    expect(duel('4', '3')).toBe(false);
    expect(duel('4', '.')).toBe(false);
  });

  it('keeps a rat in the river and the land apart', () => {
    // Rat on (1,3) in the river, elephant on land at (0,3).
    const ratInWater = with_([1, 3, '1'], [0, 3, 'h']);
    expect(jgCanCapture(ratInWater, jgIndex(1, 3), jgIndex(0, 3))).toBe(false);
    expect(targets(ratInWater, 1, 3)).not.toContain('0,3');
    // A land piece cannot take the rat in the water, nor can a land rat.
    const enemyRat = with_([1, 3, 'a'], [0, 3, '8']);
    expect(jgCanCapture(enemyRat, jgIndex(0, 3), jgIndex(1, 3))).toBe(false);
    const landRat = with_([1, 3, 'a'], [0, 3, '1']);
    expect(targets(landRat, 0, 3)).toEqual(['0,2', '0,4']);
    // A land rat still takes the elephant on land, and two rats fight in the water.
    expect(jgCanCapture(with_([0, 3, '1'], [0, 4, 'h']), jgIndex(0, 3), jgIndex(0, 4))).toBe(true);
    const waterFight = with_([1, 3, '1'], [2, 3, 'a']);
    expect(jgCanCapture(waterFight, jgIndex(1, 3), jgIndex(2, 3))).toBe(true);
  });

  it('lets a rat leave the water onto an empty bank but not by capturing', () => {
    expect(targets(with_([1, 3, '1']), 1, 3)).toEqual(['1,2', '1,4', '0,3', '2,3'].sort());
    expect(targets(with_([1, 3, '1'], [1, 2, 'a']), 1, 3)).not.toContain('1,2');
  });
});

describe('Jungle river jumps', () => {
  it('lets the lion and tiger jump the river lengthwise and across', () => {
    expect(targets(with_([1, 2, '7']), 1, 2)).toEqual(['0,2', '1,1', '1,6', '2,2']);
    expect(targets(with_([0, 3, '6']), 0, 3)).toEqual(['0,2', '0,4', '3,3']);
    expect(targets(with_([3, 4, '7']), 3, 4)).toEqual(['0,4', '3,3', '3,5', '6,4']);
  });

  it('keeps other animals from jumping', () => {
    expect(targets(with_([0, 3, '5']), 0, 3)).toEqual(['0,2', '0,4']);
    expect(targets(with_([1, 2, '8']), 1, 2)).toEqual(['0,2', '1,1', '2,2']);
  });

  it('is blocked by a rat of either side in the crossed water', () => {
    expect(targets(with_([0, 3, '6'], [2, 3, '1']), 0, 3)).not.toContain('3,3');
    expect(targets(with_([0, 3, '6'], [1, 3, 'a']), 0, 3)).not.toContain('3,3');
    expect(targets(with_([1, 2, '7'], [1, 4, '1']), 1, 2)).not.toContain('1,6');
    expect(targets(with_([1, 2, '7'], [2, 4, '1']), 1, 2)).toContain('1,6');
  });

  it('captures on landing by the usual ranks and stops at a friendly piece', () => {
    expect(targets(with_([0, 3, '6'], [3, 3, 'f']), 0, 3)).toContain('3,3');
    expect(targets(with_([0, 3, '6'], [3, 3, 'g']), 0, 3)).not.toContain('3,3');
    expect(targets(with_([0, 3, '6'], [3, 3, '2']), 0, 3)).not.toContain('3,3');
    // A rat on the landing bank is not in the water: the tiger takes it.
    expect(targets(with_([0, 3, '6'], [3, 3, 'a']), 0, 3)).toContain('3,3');
  });
});

describe('Jungle traps', () => {
  it('counts a piece in the opponent’s trap as rank 0', () => {
    // Blue elephant in red's trap at (3,7): any red piece takes it, even the cat.
    const trapped = with_([3, 7, 'h'], [3, 6, '2']);
    expect(jgTrapped(jgIndex(3, 7), 1)).toBe(true);
    expect(jgCanCapture(trapped, jgIndex(3, 6), jgIndex(3, 7))).toBe(true);
    // Even the elephant takes a trapped rat.
    expect(jgCanCapture(with_([3, 7, 'a'], [3, 6, '8']), jgIndex(3, 6), jgIndex(3, 7))).toBe(true);
  });

  it('keeps a trapped piece from capturing and an own-trap piece at full rank', () => {
    const trappedAttacker = with_([3, 7, 'h'], [2, 7, '2']);
    expect(jgCanCapture(trappedAttacker, jgIndex(3, 7), jgIndex(2, 7))).toBe(false);
    // A trapped rat loses the rat's power over the elephant.
    expect(jgCanCapture(with_([3, 7, 'a'], [3, 6, '8']), jgIndex(3, 7), jgIndex(3, 6))).toBe(false);
    // Red's own elephant in red's trap is at full rank and still takes a dog.
    expect(jgCanCapture(with_([3, 7, '8'], [3, 6, 'c']), jgIndex(3, 7), jgIndex(3, 6))).toBe(true);
    expect(jgTrapped(jgIndex(3, 7), 0)).toBe(false);
  });

  it('regains the rank on leaving the trap', () => {
    const cells = with_([3, 7, 'h'], [3, 6, '2']);
    const out = jgApply(cells, { from: jgIndex(3, 7), to: jgIndex(2, 7) });
    expect(jgTrapped(jgIndex(2, 7), 1)).toBe(false);
    expect(jgCanCapture(with_([2, 7, 'h'], [2, 6, '2']), jgIndex(2, 7), jgIndex(2, 6))).toBe(true);
    expect(out[jgIndex(2, 7)]).toBe(16);
  });
});

describe('Jungle end of the game', () => {
  it('ends when a piece enters the opponent’s den', () => {
    const cells = with_([3, 0, '4'], [6, 8, 'h']);
    expect(jgOutcome(cells, 0, jgDenCell(1), 1)).toEqual({ winner: 0, reason: 'den-entered' });
    expect(jgDenCell(0)).toBe(jgIndex(3, 8));
  });

  it('ends when the opponent has no pieces or no legal move', () => {
    expect(jgOutcome(with_([0, 0, '4']), 0, jgIndex(0, 0), 5)).toEqual({ winner: 0, reason: 'all-captured' });
    // A blue rat boxed into the corner by two lions it cannot take.
    const boxed = with_([0, 0, 'a'], [1, 0, '7'], [0, 1, '7'], [6, 8, '2']);
    expect(jgHasMove(boxed, 1)).toBe(false);
    expect(jgOutcome(boxed, 0, jgIndex(6, 8), 5)).toEqual({ winner: 0, reason: 'no-moves' });
    expect(jgOutcome(with_([0, 0, 'a'], [3, 3, '4'], [6, 8, '2']), 0, jgIndex(6, 8), 5)).toBeNull();
  });

  it('draws after the quiet-ply limit and counts plies back to the last capture', () => {
    const cells = with_([0, 0, '4'], [6, 8, 'd']);
    expect(jgOutcome(cells, 0, jgIndex(0, 1), JG_NO_CAPTURE_LIMIT - 1)).toBeNull();
    expect(jgOutcome(cells, 0, jgIndex(0, 1), JG_NO_CAPTURE_LIMIT)).toEqual({ winner: null, reason: 'no-capture-limit' });
    expect(jgQuietPlies([{ capture: true }, { capture: false }, { capture: false }])).toBe(2);
    expect(jgQuietPlies([{ capture: false }, { capture: true }])).toBe(0);
    expect(jgQuietPlies([])).toBe(0);
  });

  it('maps outcomes onto the seats in play order', () => {
    expect(jgBoardOutcome({ winner: 1, reason: 'no-moves' }, ['E', 'W'])).toEqual({ winners: ['W'], reason: 'no-moves' });
    expect(jgBoardOutcome({ winner: null, reason: 'no-capture-limit' }, ['E', 'W'])).toEqual({ winners: [], reason: 'no-capture-limit' });
  });
});

describe('Jungle helpers', () => {
  it('converts between nodes and cells and rejects foreign ids', () => {
    expect(jgCell('3,8')).toBe(jgIndex(3, 8));
    expect(jgNode(jgIndex(6, 2))).toBe('6,2');
    for (const bad of ['7,0', '0,9', '-1,0', 'a1', 12, null, '03,1']) expect(jgCell(bad)).toBeNull();
  });

  it('checks legality for the side on move and applies moves without touching the input', () => {
    const cells = jgInitialCells();
    const before = [...cells];
    const move = jgLegalMoves(cells, 0)[0];
    expect(jgIsLegal(cells, move.from, move.to, 0)).toBe(true);
    expect(jgIsLegal(cells, move.from, move.to, 1)).toBe(false);
    expect(jgIsLegal(cells, 0, 62, 0)).toBe(false);
    const next = jgApply(cells, move);
    expect(cells).toEqual(before);
    expect(next[move.to]).toBe(cells[move.from]);
    expect(next[move.from]).toBe(0);
    expect(jgPieceCount(next, 0)).toBe(8);
  });

  it('rejects malformed positions', () => {
    expect(isJgCells(jgInitialCells())).toBe(true);
    expect(isJgCells(jgInitialCells().slice(1))).toBe(false);
    expect(isJgCells([...jgInitialCells().slice(1), 17])).toBe(false);
    expect(isJgCells([...jgInitialCells().slice(1), 1.5])).toBe(false);
  });
});
