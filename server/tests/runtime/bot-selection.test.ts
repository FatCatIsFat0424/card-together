import { describe, expect, it, vi } from 'vitest';
import { selectNearBest } from '../../src/bots/selection';
import { seededRandom } from '../../src/bots/search/seeded-random';

describe('bounded hard-bot variation', () => {
  it('varies comparable choices without selecting a tactical blunder', () => {
    const choices = Object.freeze([
      Object.freeze({ value: 'best', score: 10 }),
      Object.freeze({ value: 'comparable', score: 9.8 }),
      Object.freeze({ value: 'blunder', score: 0 }),
    ]);
    const random = seededRandom(127);
    const counts = { best: 0, comparable: 0, blunder: 0 };
    for (let index = 0; index < 4096; index++) counts[selectNearBest(choices, random, 0.3)!]++;
    expect(counts.blunder).toBe(0);
    expect(counts.best).toBeGreaterThan(counts.comparable);
    expect(counts.comparable).toBeGreaterThan(1000);
  });

  it('keeps a uniquely necessary move regardless of the supplied random source', () => {
    const random = vi.fn(() => { throw new Error('A forced move must not draw randomness.'); });
    expect(selectNearBest([{ value: 'save-partner', score: 100 }, { value: 'lose', score: 5 }], random, 1))
      .toBe('save-partner');
    expect(random).not.toHaveBeenCalled();
  });

  it('replays decisions from an injected seed and varies equally good choices', () => {
    const options = ['clubs', 'diamonds', 'hearts', 'spades'].map((value) => ({ value, score: 10 }));
    const run = (): (string | null)[] => {
      const random = seededRandom(42);
      return Array.from({ length: 64 }, () => selectNearBest(options, random, 0));
    };
    expect(run()).toEqual(run());
    expect(new Set(run()).size).toBe(4);
  });

  it('handles no available option and rejects invalid randomness before choosing', () => {
    expect(selectNearBest([], () => 0, 1)).toBeNull();
    for (const sample of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1]) {
      expect(() => selectNearBest([{ value: 1, score: 1 }, { value: 2, score: 1 }], () => sample, 0))
        .toThrow(RangeError);
    }
  });
});
