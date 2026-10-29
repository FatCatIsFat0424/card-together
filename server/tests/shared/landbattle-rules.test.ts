import { describe, expect, it } from 'vitest';
import {
  LB_COUNTS, LB_NODES, LB_PRESETS, LB_RANKS, LB_SLOT_POSITIONS, lbApplyMove, lbBattle, lbBoardFromLayouts, lbCell,
  lbDeploySeconds, lbDeploySlots, lbDestinations, lbHasMove, lbIndex, lbIsCamp, lbIsHq, lbLayoutError, lbLegalMoves,
  lbMirrorLayout, lbNode, lbRandomLayout, lbSlotIndex, lbSwapSlots,
} from '@shared/rules/landbattle';
import type { LbCell, LbRank, LbSide } from '@shared/rules/landbattle';
import { seededRandom } from '../../src/bots/search/seeded-random';

type Placed = readonly [col: number, row: number, side: LbSide, rank: LbRank];

function board(pieces: readonly Placed[]): (LbCell & { rank: LbRank })[] {
  const cells: ((LbCell & { rank: LbRank }) | null)[] = new Array(LB_NODES).fill(null);
  for (const [col, row, side, rank] of pieces) cells[lbIndex(col, row)] = { side, rank };
  return cells as (LbCell & { rank: LbRank })[];
}

const targets = (cells: readonly (LbCell | null)[], col: number, row: number): string[] =>
  lbDestinations(cells, lbIndex(col, row)).map((move) => lbNode(move.to)).sort();

describe('Land Battle Chess deployment', () => {
  it('has 25 slots per side, front row first, skipping the five camps', () => {
    expect(LB_SLOT_POSITIONS).toHaveLength(25);
    const perRow = [0, 1, 2, 3, 4, 5].map((row) => LB_SLOT_POSITIONS.filter(([, r]) => r === row).length);
    expect(perRow).toEqual([5, 3, 4, 3, 5, 5]);
    for (const side of [0, 1] as const) {
      const slots = lbDeploySlots(side);
      expect(new Set(slots).size).toBe(25);
      expect(slots.some(lbIsCamp)).toBe(false);
      expect(slots.every((index) => (side === 0 ? index >= 30 : index < 30))).toBe(true);
    }
    // The first slot is each side's own front-left station.
    expect(lbNode(lbSlotIndex(0, 0))).toBe('0,6');
    expect(lbNode(lbSlotIndex(1, 0))).toBe('4,5');
    expect([lbSlotIndex(0, 21), lbSlotIndex(0, 23)].every(lbIsHq)).toBe(true);
    expect([lbSlotIndex(1, 21), lbSlotIndex(1, 23)].every(lbIsHq)).toBe(true);
    expect(lbDeploySeconds(60, 300)).toBe(360);
    expect(lbDeploySeconds(5, 0)).toBe(60);
  });

  it('accepts every preset, its mirror, and random layouts', () => {
    for (const layout of LB_PRESETS) {
      expect(lbLayoutError(layout)).toBeNull();
      expect(lbLayoutError(lbMirrorLayout(layout))).toBeNull();
    }
    for (let seed = 1; seed <= 200; seed++) expect(lbLayoutError(lbRandomLayout(seededRandom(seed)))).toBeNull();
    expect(lbRandomLayout(seededRandom(3))).not.toEqual(lbRandomLayout(seededRandom(4)));
  });

  it('rejects incomplete sets, a flag outside headquarters, forward mines, and front-row bombs', () => {
    const base = [...LB_PRESETS[0]];
    expect(lbLayoutError(base.slice(1))).not.toBeNull();
    expect(lbLayoutError(base.map((rank) => (rank === 'bomb' ? 'marshal' : rank)))).not.toBeNull();
    expect(lbLayoutError([...base.slice(0, 24), 'unknown'])).not.toBeNull();
    const swap = (a: number, b: number): LbRank[] => {
      const next = [...base];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    };
    const flag = base.indexOf('flag');
    const mine = base.indexOf('mine');
    const bomb = base.indexOf('bomb');
    expect(lbLayoutError(swap(flag, 20))).toMatch(/flag/);
    expect(lbLayoutError(swap(mine, 0))).toMatch(/mines/);
    expect(lbLayoutError(swap(bomb, 0))).toMatch(/bombs/);
    expect(lbSwapSlots(base, flag, 20)).toBeNull();
    expect(lbSwapSlots(base, mine, 0)).toBeNull();
    expect(lbSwapSlots(base, bomb, 1)).toBeNull();
    const swapped = lbSwapSlots(base, 0, 1);
    expect(swapped && lbLayoutError(swapped)).toBeNull();
    expect(swapped?.[0]).toBe(base[1]);
  });

  it('places both layouts facing each other with stable origins', () => {
    const cells = lbBoardFromLayouts([LB_PRESETS[0], LB_PRESETS[1]]);
    expect(cells.filter(Boolean)).toHaveLength(50);
    expect(cells[lbSlotIndex(0, 0)]).toEqual({ side: 0, rank: LB_PRESETS[0][0], origin: lbSlotIndex(0, 0) });
    expect(cells[lbSlotIndex(1, 3)]).toEqual({ side: 1, rank: LB_PRESETS[1][3], origin: lbSlotIndex(1, 3) });
    for (const rank of LB_RANKS) {
      expect(cells.filter((cell) => cell?.side === 0 && cell.rank === rank)).toHaveLength(LB_COUNTS[rank]);
    }
  });
});

describe('Land Battle Chess movement', () => {
  it('steps one station along roads and camp diagonals, but never across the mountains', () => {
    expect(targets(board([[1, 8, 0, 'captain']]), 1, 8).sort()).toEqual(['0,8', '1,7', '1,9', '2,8'].sort());
    // Camp (2,8) joins all four diagonal neighbours.
    expect(targets(board([[2, 8, 0, 'captain']]), 2, 8)).toEqual(['1,7', '1,8', '1,9', '2,7', '2,9', '3,7', '3,8', '3,9'].sort());
    // Files 1 and 3 do not cross the front line.
    expect(targets(board([[1, 6, 0, 'captain']]), 1, 6)).not.toContain('1,5');
    expect(targets(board([[2, 6, 0, 'captain']]), 2, 6)).toContain('2,5');
  });

  it('runs straight along railways, stops before own pieces, and attacks the first opponent', () => {
    const open = targets(board([[0, 6, 0, 'colonel']]), 0, 6);
    expect(open).toContain('0,1');
    expect(open).toContain('4,6');
    // No turning: row 1 and row 10 stay out of reach for a colonel on file 0.
    expect(open).not.toContain('1,1');
    expect(open).not.toContain('1,10');
    const blocked = targets(board([[0, 6, 0, 'colonel'], [0, 3, 0, 'captain'], [3, 6, 1, 'major']]), 0, 6);
    expect(blocked).toContain('0,4');
    expect(blocked).not.toContain('0,3');
    expect(blocked).not.toContain('0,2');
    expect(blocked).toContain('3,6');
    expect(blocked).not.toContain('4,6');
    const run = lbDestinations(board([[0, 6, 0, 'colonel']]), lbIndex(0, 6)).find((move) => move.to === lbIndex(0, 1));
    expect(run?.path.map(lbNode)).toEqual(['0,5', '0,4', '0,3', '0,2']);
  });

  it('lets engineers turn along railways with the shortest route', () => {
    const cells = board([[0, 6, 0, 'engineer'], [2, 1, 1, 'major']]);
    const reach = targets(cells, 0, 6);
    expect(reach).toContain('1,1');
    expect(reach).toContain('4,10');
    expect(reach).toContain('2,1');
    // (3,1) is still reached the long way round through file 4.
    expect(reach).toContain('3,1');
    const route = lbDestinations(cells, lbIndex(0, 6)).find((move) => move.to === lbIndex(2, 1));
    expect(route?.path.map(lbNode)).toEqual(['0,5', '0,4', '0,3', '0,2', '0,1', '1,1']);
  });

  it('protects camp occupants and keeps headquarters pieces, mines, and the flag still', () => {
    const cells = board([[1, 3, 0, 'marshal'], [1, 2, 1, 'lieutenant'], [1, 4, 1, 'mine'], [1, 0, 1, 'major'], [3, 0, 1, 'flag']]);
    expect(targets(cells, 1, 3)).not.toContain('1,2');
    expect(lbDestinations(cells, lbIndex(1, 4))).toEqual([]);
    expect(lbDestinations(cells, lbIndex(1, 0))).toEqual([]);
    expect(lbDestinations(cells, lbIndex(3, 0))).toEqual([]);
    expect(lbLegalMoves(cells, 1).every((move) => move.from === lbIndex(1, 2))).toBe(true);
    expect(lbHasMove(board([[1, 0, 1, 'major'], [3, 0, 1, 'flag'], [0, 0, 1, 'mine'], [2, 6, 0, 'captain']]), 1)).toBe(false);
  });
});

describe('Land Battle Chess battles', () => {
  it('lets the higher rank win, removes equals together, bombs everything, and only engineers clear mines', () => {
    expect(lbBattle('marshal', 'general')).toBe('win');
    expect(lbBattle('lieutenant', 'captain')).toBe('lose');
    expect(lbBattle('major', 'major')).toBe('tie');
    expect(lbBattle('bomb', 'marshal')).toBe('tie');
    expect(lbBattle('engineer', 'bomb')).toBe('tie');
    expect(lbBattle('engineer', 'mine')).toBe('win');
    expect(lbBattle('marshal', 'mine')).toBe('lose');
    expect(lbBattle('bomb', 'mine')).toBe('tie');
    expect(lbBattle('engineer', 'flag')).toBe('win');
    expect(lbBattle('bomb', 'flag')).toBe('win');
  });

  it('applies outcomes to the board and reports a captured flag', () => {
    const cells = board([[2, 6, 0, 'general'], [2, 5, 1, 'major'], [0, 6, 0, 'captain'], [0, 5, 1, 'mine'], [3, 1, 0, 'engineer'], [3, 0, 1, 'flag']]);
    const won = lbApplyMove(cells, lbIndex(2, 6), lbIndex(2, 5))!;
    expect([won.outcome, won.board[lbIndex(2, 5)]?.rank, won.board[lbIndex(2, 6)]]).toEqual(['win', 'general', null]);
    const lost = lbApplyMove(cells, lbIndex(0, 6), lbIndex(0, 5))!;
    expect([lost.outcome, lost.board[lbIndex(0, 5)]?.rank, lost.removed.map((piece) => piece.rank)]).toEqual(['lose', 'mine', ['captain']]);
    const flag = lbApplyMove(cells, lbIndex(3, 1), lbIndex(3, 0))!;
    expect([flag.outcome, flag.flagCaptured]).toEqual(['win', true]);
    expect(lbApplyMove(cells, lbIndex(2, 6), lbIndex(2, 3))).toBeNull();
    expect(lbCell('4,11')).toBe(59);
    expect(lbCell('5,0')).toBeNull();
    expect(lbCell('0,12')).toBeNull();
  });
});
