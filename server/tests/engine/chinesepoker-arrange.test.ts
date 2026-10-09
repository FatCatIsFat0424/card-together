import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { cpEvaluate, cpIsFoul, cpIsValidArrangement } from '@shared/rules/chinesepoker';
import {
  cpArrangementScore,
  cpBestArrangement,
  cpGreedyArrangement,
  cpRankArrangements,
} from '@shared/rules/chinesepoker-arrange';
import { createDeck, shuffleDeck } from '../../src/engine/deck';

/** Deterministic LCG so failures reproduce */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function hands(count: number, seed: number): Card[][] {
  const random = seeded(seed);
  return Array.from({ length: count }, () => shuffleDeck(createDeck(), random).slice(0, 13));
}

describe('Chinese Poker greedy arrangement', () => {
  it('should never foul and always use the dealt cards', () => {
    for (const hand of hands(500, 7)) {
      const arrangement = cpGreedyArrangement(hand);
      expect(cpIsValidArrangement(hand, arrangement)).toBe(true);
      expect(cpIsFoul(arrangement)).toBe(false);
    }
  });

  it('should reject hands that are not 13 cards', () => {
    expect(() => cpGreedyArrangement(createDeck().slice(0, 12))).toThrow(RangeError);
    expect(() => cpRankArrangements(createDeck().slice(0, 14), 1)).toThrow(RangeError);
  });
});

describe('Chinese Poker arrangement search', () => {
  it('should never foul and score at least as well as greedy', () => {
    for (const hand of hands(150, 11)) {
      const before = structuredClone(hand);
      const ranked = cpRankArrangements(hand, 5);
      expect(hand).toEqual(before);
      expect(ranked).toHaveLength(5);
      for (let i = 0; i < ranked.length; i++) {
        expect(cpIsValidArrangement(hand, ranked[i].arrangement)).toBe(true);
        expect(cpIsFoul(ranked[i].arrangement)).toBe(false);
        expect(cpArrangementScore(ranked[i].arrangement)).toBeCloseTo(ranked[i].score, 9);
        if (i > 0) expect(ranked[i].score).toBeLessThanOrEqual(ranked[i - 1].score);
      }
      expect(ranked[0].score).toBeGreaterThanOrEqual(cpArrangementScore(cpGreedyArrangement(hand)) - 1e-9);
      expect(cpBestArrangement(hand)).toEqual(ranked[0].arrangement);
    }
  });

  it('should keep a straight flush in the back over splitting it', () => {
    const hand: Card[] = [
      ...[9, 10, 11, 12, 13].map((rank) => ({ suit: 'hearts', rank }) as Card),
      { suit: 'spades', rank: 2 }, { suit: 'clubs', rank: 4 }, { suit: 'diamonds', rank: 6 },
      { suit: 'spades', rank: 7 }, { suit: 'clubs', rank: 8 }, { suit: 'diamonds', rank: 14 },
      { suit: 'clubs', rank: 14 }, { suit: 'spades', rank: 3 },
    ];
    expect(cpEvaluate(cpBestArrangement(hand).back).category).toBe('straightFlush');
  });

  it('should arrange well within the interactive time budget', () => {
    const sample = hands(21, 23);
    cpRankArrangements(sample[0], 6);
    const times = sample.slice(1).map((hand) => {
      const start = performance.now();
      cpRankArrangements(hand, 6);
      return performance.now() - start;
    });
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    expect(average).toBeLessThan(50);
    expect(Math.max(...times)).toBeLessThan(200);
  });
});
