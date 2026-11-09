import { describe, expect, it } from 'vitest';
import { fitHand, HAND_GAP, HAND_HIT, HAND_HIT_NARROW } from '../../../client/src/games/dominoes/dominoes-hand';

const used = (perRow: number, hit: number): number => perRow * hit + (perRow - 1) * HAND_GAP;

describe('Dominoes hand layout', () => {
  it('keeps a hand in one row while every tile has a full tap area', () => {
    expect(fitHand(7, 420)).toEqual({ rows: 1, perRow: 7, hit: HAND_HIT });
    expect(fitHand(1, 420)).toEqual({ rows: 1, perRow: 1, hit: HAND_HIT });
    expect(fitHand(0, 420).rows).toBe(1);
  });

  it('wraps into balanced rows rather than shrinking the tap areas', () => {
    const fit = fitHand(14, 300);
    expect(fit).toEqual({ rows: 2, perRow: 7, hit: HAND_HIT });
    expect(fitHand(13, 300)).toMatchObject({ rows: 2, perRow: 7 });
  });

  it('keeps full-size tap areas up to fourteen tiles and the narrow minimum up to twenty-one at phone widths', () => {
    for (const width of [412, 524]) {
      for (let count = 1; count <= 14; count++) expect(fitHand(count, width).hit).toBe(HAND_HIT);
      for (let count = 15; count <= 21; count++) {
        const fit = fitHand(count, width);
        expect(fit.hit).toBeGreaterThanOrEqual(HAND_HIT_NARROW);
        expect(fit.rows).toBeLessThanOrEqual(2);
      }
    }
  });

  it('never exceeds the box and always seats every tile', () => {
    for (const width of [120, 180, 260, 412, 524, 900]) {
      for (let count = 1; count <= 28; count++) {
        const fit = fitHand(count, width);
        expect(fit.rows * fit.perRow).toBeGreaterThanOrEqual(count);
        expect((fit.rows - 1) * fit.perRow).toBeLessThan(count);
        if (width >= 180) expect(used(fit.perRow, fit.hit)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('adds rows for a narrow box and tolerates an unmeasured one', () => {
    expect(fitHand(21, 180).rows).toBeGreaterThan(2);
    expect(fitHand(12, 0)).toMatchObject({ rows: 1, hit: HAND_HIT });
  });
});
