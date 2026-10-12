import { describe, expect, it } from 'vitest';
import { SEVENS_COLLAPSE_MS } from '@shared/sevens-options';
import type { SevensLogEntry } from '@shared/types';
import {
  COLLAPSE_MS, collapseShade, collapseShake, CRACK_GROW_MS, CRACK_OPEN_MS, crackReach, crackWidth, openProgress,
  SHAKE_MS, shatterTable,
} from '../../../client/src/games/sevens/table-collapse-scene';
import { collapsedByLog } from '../../../client/src/games/sevens/sevens-view';

const impact = { x: 450, y: 200 };
const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('table collapse scene', () => {
  it('keeps compact shards and cracks finite and inside the padded table', () => {
    const width = 320;
    const height = 160;
    const scene = shatterTable(width, height, { x: width / 2, y: height / 2 });
    expect(scene.shards.length).toBeGreaterThan(0);
    expect(scene.cracks.length).toBeGreaterThan(0);
    for (const shard of scene.shards) {
      expect(shard.polygon.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(shard.depth)).toBe(true);
      expect(shard.depth).toBeGreaterThanOrEqual(0);
      expect(shard.depth).toBeLessThanOrEqual(1);
      for (const point of shard.polygon) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(point.x).toBeGreaterThanOrEqual(-30.000001);
        expect(point.x).toBeLessThanOrEqual(width + 30.000001);
        expect(point.y).toBeGreaterThanOrEqual(-30.000001);
        expect(point.y).toBeLessThanOrEqual(height + 30.000001);
      }
    }
    for (const crack of scene.cracks) {
      expect(crack.lengths.every(Number.isFinite)).toBe(true);
      expect(crack.lengths.at(-1)).toBeGreaterThan(0);
    }
  });

  it.each([[0, 0], [0, 160], [320, 0]])('does not generate shards for a %s×%s table', (width, height) => {
    const scene = shatterTable(width, height, { x: 0, y: 0 });
    expect(scene.shards).toHaveLength(0);
    expect(scene.cracks).toHaveLength(0);
  });

  it('shares the frame length and finishes opening before the frame ends', () => {
    expect(COLLAPSE_MS).toBe(SEVENS_COLLAPSE_MS);
    expect(CRACK_OPEN_MS[1]).toBeLessThan(COLLAPSE_MS);
    expect(SHAKE_MS).toBeLessThan(COLLAPSE_MS);
  });

  it('breaks the same way for every viewer into shards that are small near the impact and large far from it', () => {
    const shatter = shatterTable(900, 400, impact);
    expect(shatterTable(900, 400, impact)).toEqual(shatter);
    expect(shatter.shards.length).toBeGreaterThan(30);
    const area = (polygon: readonly { x: number; y: number }[]): number => Math.abs(polygon.reduce((total, point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return total + point.x * next.y - next.x * point.y;
    }, 0)) / 2;
    const byDistance = [...shatter.shards].sort((a, b) => distance(a.center, impact) - distance(b.center, impact));
    const third = Math.floor(byDistance.length / 3);
    const mean = (shards: typeof byDistance): number => shards.reduce((total, shard) => total + area(shard.polygon), 0)
      / shards.length;
    expect(mean(byDistance.slice(0, third))).toBeLessThan(mean(byDistance.slice(-third)));
    // The pieces at the impact fall in; the rest stay.
    const fallen = shatter.shards.filter((shard) => shard.fallen);
    expect(fallen.length).toBeGreaterThan(0);
    expect(fallen.length).toBeLessThan(shatter.shards.length / 4);
  });

  it('splits each crack outward from the impact, nearer cracks first and wider', () => {
    const { cracks } = shatterTable(900, 400, impact);
    for (const crack of cracks) {
      expect(distance(crack.points[0], impact)).toBeLessThanOrEqual(distance(crack.points[crack.points.length - 1], impact));
      expect(crack.start).toBeGreaterThanOrEqual(0);
      expect(crack.start).toBeLessThanOrEqual(CRACK_GROW_MS);
    }
    const nearest = cracks.reduce((best, crack) => (crack.start < best.start ? crack : best));
    const farthest = cracks.reduce((best, crack) => (crack.start > best.start ? crack : best));
    expect(nearest.width).toBeGreaterThan(farthest.width);
  });

  it('splits a crack along its length, then opens it from a hairline to its full width', () => {
    const [crack] = shatterTable(900, 400, impact).cracks;
    const length = crack.lengths[crack.lengths.length - 1];
    expect(crackReach(crack, crack.start - 1)).toBe(0);
    expect(crackReach(crack, crack.start + crack.grow / 2)).toBeCloseTo(length / 2);
    expect(crackReach(crack, COLLAPSE_MS)).toBe(length);
    expect(crackWidth(crack, 0)).toBeLessThan(1);
    expect(crackWidth(crack, CRACK_OPEN_MS[1])).toBeCloseTo(Math.max(0.8, crack.width));
    expect(openProgress(CRACK_OPEN_MS[0])).toBe(0);
    expect(openProgress(CRACK_OPEN_MS[1])).toBe(1);
  });

  it('jolts only early and leaves a lasting shade', () => {
    expect(Math.hypot(collapseShake(50).x, collapseShake(50).y)).toBeGreaterThan(0);
    expect(collapseShake(SHAKE_MS + 1)).toEqual({ x: 0, y: 0 });
    expect(collapseShade(0)).toBe(0);
    expect(collapseShade(COLLAPSE_MS)).toBeCloseTo(0.3);
  });

  it('recognizes a match ended by the collapse from its log', () => {
    const play: SevensLogEntry = { type: 'play', seat: 'N', card: { suit: 'spades', rank: 7 }, timestamp: 0 };
    expect(collapsedByLog([play, { type: 'cover', seat: 'W', timestamp: 0 }])).toBe(false);
    expect(collapsedByLog([play, { type: 'cover', seat: 'W', timestamp: 0, auto: true }])).toBe(true);
  });
});
