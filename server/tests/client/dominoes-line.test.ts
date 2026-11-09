import { describe, expect, it } from 'vitest';
import type { DominoPip, DominoPlacement } from '@shared/games/dominoes/types';
import { dmAllTiles } from '@shared/rules/dominoes';
import { fitLine, lineGap, lineSlots, reversedRow } from '../../../client/src/games/dominoes/dominoes-line';
import type { LineSlot } from '../../../client/src/games/dominoes/dominoes-line';

/** A legal line of the first `count` tiles, each added to the right end. */
function lineOf(count: number): DominoPlacement[] {
  return dmAllTiles().slice(0, count).map((tile) => ({ tile, left: tile[0] as DominoPip, right: tile[1] as DominoPip }));
}

const widthOf = (slot: LineSlot, edge: number): number => edge * (slot.kind === 'marker' ? 1.25 : slot.double ? 1 : 2);

describe('Dominoes line layout', () => {
  it('puts a marker for each open end around the tiles', () => {
    const slots = lineSlots(lineOf(5));
    expect(slots).toHaveLength(7);
    expect(slots[0]).toMatchObject({ kind: 'marker', side: 'left' });
    expect(slots[6]).toMatchObject({ kind: 'marker', side: 'right' });
    expect(slots.slice(1, 6).map((slot) => slot.index)).toEqual([0, 1, 2, 3, 4]);
    expect(slots.filter((slot) => slot.double)).toHaveLength(1);
  });

  it('keeps every slot in order, once, and every row inside the box', () => {
    for (const [width, height] of [[420, 100], [260, 120], [900, 400], [150, 60]] as const) {
      for (const count of [1, 7, 14, 28]) {
        const slots = lineSlots(lineOf(count));
        const fit = fitLine(slots, width, height);
        expect(fit.rows.flat()).toEqual(slots.map((_, index) => index));
        for (const row of fit.rows) {
          const used = row.reduce((sum, index) => sum + widthOf(slots[index], fit.edge), 0) + lineGap(fit.edge) * (row.length - 1);
          if (fit.edge > 8) expect(used).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it('shrinks the tiles as the line grows and fits the whole line when it can', () => {
    const small = fitLine(lineSlots(lineOf(3)), 420, 100);
    const full = fitLine(lineSlots(lineOf(28)), 420, 100);
    expect(small.edge).toBeGreaterThan(full.edge);
    expect(full.edge).toBeGreaterThanOrEqual(8);
    // A phone-landscape centre of about 420 x 100 still shows a full set legibly.
    expect(full.edge).toBeGreaterThanOrEqual(12);
    expect(full.rows.length).toBeGreaterThan(1);
  });

  it('snakes: odd rows run back', () => {
    expect([0, 1, 2, 3].map(reversedRow)).toEqual([false, true, false, true]);
  });
});
