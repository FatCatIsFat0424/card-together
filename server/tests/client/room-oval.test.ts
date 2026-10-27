import { describe, expect, it } from 'vitest';
import { ovalPosition } from '../../../client/src/pages/room-oval';

const at = (index: number, first: number, count: number): { x: number; y: number } => {
  const style = ovalPosition(index, first, count) as Record<string, string>;
  return { x: Number(style['--cx']), y: Number(style['--cy']) };
};

describe('waiting-room seat oval', () => {
  it('puts the first seat at the bottom and follows clockwise on screen', () => {
    expect(at(0, 0, 4)).toEqual({ x: 0, y: 1 });
    expect(at(1, 0, 4).x).toBeCloseTo(-1, 3);
    expect(at(2, 0, 4).y).toBeCloseTo(-1, 3);
    expect(at(3, 0, 4).x).toBeCloseTo(1, 3);
  });

  it('keeps the viewer at the bottom whichever seat they hold', () => {
    expect(at(2, 2, 4)).toEqual({ x: 0, y: 1 });
    expect(at(3, 2, 8).x).toBeLessThan(0);
  });

  it('lays out two and three seats, which new games need, on opposite sides', () => {
    expect(at(1, 0, 2).y).toBeCloseTo(-1, 3);
    const [bottom, left, right] = [at(0, 0, 3), at(1, 0, 3), at(2, 0, 3)];
    expect(bottom.y).toBe(1);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);
    expect(left.y).toBeCloseTo(right.y, 3);
  });

  it('spreads eight seats without sharing a position', () => {
    const spots = new Set(Array.from({ length: 8 }, (_, index) => JSON.stringify(at(index, 0, 8))));
    expect(spots.size).toBe(8);
  });
});
