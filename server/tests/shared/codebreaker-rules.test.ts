import { describe, expect, it } from 'vitest';
import {
  CB_MAX_GUESSES, DEFAULT_CODEBREAKER_OPTIONS, cbAllCodes, cbConsistent, cbFeedback, cbRandomCode, cbRank, cbRoundSeconds,
  cbWinners, isCbCode, isCodeBreakerOptions,
} from '@shared/rules/codebreaker';
import { seededRandom } from '../../src/bots/search/seeded-random';

describe('Code Breaker feedback', () => {
  it('counts right digits in the right place as A and right digits elsewhere as B', () => {
    expect(cbFeedback([1, 2, 3, 4], [1, 2, 3, 4])).toEqual({ exact: 4, partial: 0 });
    expect(cbFeedback([1, 2, 3, 4], [4, 3, 2, 1])).toEqual({ exact: 0, partial: 4 });
    expect(cbFeedback([1, 2, 3, 4], [1, 3, 5, 6])).toEqual({ exact: 1, partial: 1 });
    expect(cbFeedback([1, 2, 3, 4], [5, 6, 7, 8])).toEqual({ exact: 0, partial: 0 });
  });

  it('counts repeated colours no more often than the secret holds them', () => {
    expect(cbFeedback([0, 0, 1, 2], [0, 3, 0, 0])).toEqual({ exact: 1, partial: 1 });
    expect(cbFeedback([0, 1, 2, 3], [0, 0, 0, 0])).toEqual({ exact: 1, partial: 0 });
    expect(cbFeedback([0, 0, 1, 1], [1, 1, 0, 0])).toEqual({ exact: 0, partial: 4 });
    expect(cbFeedback([5, 5, 5, 5], [5, 5, 5, 5])).toEqual({ exact: 4, partial: 0 });
  });

  it('is symmetric between secret and guess', () => {
    const random = seededRandom(7);
    for (let index = 0; index < 200; index++) {
      const a = cbRandomCode('colors', random);
      const b = cbRandomCode('colors', random);
      expect(cbFeedback(a, b)).toEqual(cbFeedback(b, a));
    }
  });
});

describe('Code Breaker codes', () => {
  it('accepts only well-formed codes for the variant', () => {
    expect(isCbCode([0, 1, 2, 3], 'digits')).toBe(true);
    expect(isCbCode([0, 1, 1, 3], 'digits')).toBe(false);
    expect(isCbCode([0, 1, 2, 10], 'digits')).toBe(false);
    expect(isCbCode([0, 1, 2], 'digits')).toBe(false);
    expect(isCbCode([0, 0, 5, 5], 'colors')).toBe(true);
    expect(isCbCode([0, 0, 5, 6], 'colors')).toBe(false);
    expect(isCbCode([0, 1.5, 2, 3], 'colors')).toBe(false);
    expect(isCbCode('0123', 'digits')).toBe(false);
  });

  it('enumerates every code of each variant', () => {
    expect(cbAllCodes('digits')).toHaveLength(5040);
    expect(cbAllCodes('colors')).toHaveLength(1296);
    expect(cbAllCodes('digits').every((code) => isCbCode(code, 'digits'))).toBe(true);
  });

  it('draws distinct digits and any colours, and keeps the true secret consistent with its own feedback', () => {
    const random = seededRandom(11);
    for (let index = 0; index < 100; index++) {
      const digits = cbRandomCode('digits', random);
      expect(isCbCode(digits, 'digits')).toBe(true);
      const colors = cbRandomCode('colors', random);
      expect(isCbCode(colors, 'colors')).toBe(true);
      const guess = cbRandomCode('colors', random);
      const feedback = cbFeedback(colors, guess);
      expect(cbConsistent(colors, [{ code: guess, ...feedback }])).toBe(true);
    }
  });

  it('validates room options', () => {
    expect(isCodeBreakerOptions(DEFAULT_CODEBREAKER_OPTIONS)).toBe(true);
    expect(isCodeBreakerOptions({ variant: 'colors' })).toBe(true);
    expect(isCodeBreakerOptions({ variant: 'letters' })).toBe(false);
    expect(isCodeBreakerOptions({ variant: 'digits', extra: true })).toBe(false);
    expect(isCodeBreakerOptions(null)).toBe(false);
  });
});

describe('Code Breaker ranking', () => {
  const finishes = [
    { seat: 'N', guesses: 5, solved: true },
    { seat: 'E', guesses: 3, solved: true },
    { seat: 'S', guesses: 3, solved: true },
    { seat: 'W', guesses: CB_MAX_GUESSES, solved: false },
    { seat: 'P5', guesses: CB_MAX_GUESSES, solved: false },
  ] as const;

  it('ranks solvers by fewest guesses with shared ranks and puts everyone else tied last', () => {
    expect(finishes.map((finish) => cbRank(finishes, finish.seat))).toEqual([3, 1, 1, 4, 4]);
    expect(cbWinners(finishes)).toEqual(['E', 'S']);
  });

  it('has no winner when nobody solved', () => {
    const unsolved = finishes.map((finish) => ({ ...finish, solved: false }));
    expect(cbWinners(unsolved)).toEqual([]);
  });

  it('gives the round at least the minimum window and the whole room timer otherwise', () => {
    expect(cbRoundSeconds(5, 0)).toBe(20);
    expect(cbRoundSeconds(60, 0)).toBe(60);
    expect(cbRoundSeconds(60, 30)).toBe(90);
  });
});
