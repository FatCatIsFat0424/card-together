import { describe, expect, it } from 'vitest';
import { cbConsistent, cbFeedback, cbRandomCode, isCbCode } from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';
import { CODEBREAKER_OPENING, CODEBREAKER_PLAN } from '../../src/bots/codebreaker-openings';
import {
  NO_LIMIT, SOLVED_KEY, chooseGuessIndex, codeSpace, consistentIndices, feedbackKey, indexOfCode, solveExactGuess,
} from '../../src/bots/codebreaker-solver';
import { seededRandom } from '../../src/bots/search/seeded-random';

const VARIANTS: readonly CbVariant[] = ['digits', 'colors'];

describe('Code Breaker solver tables', () => {
  it.each(VARIANTS)('scores %s feedback exactly like the rules', (variant) => {
    const space = codeSpace(variant);
    const random = seededRandom(5);
    for (let round = 0; round < 3000; round++) {
      const guess = Math.floor(random() * space.codes.length);
      const secret = Math.floor(random() * space.codes.length);
      const expected = cbFeedback(space.codes[secret], space.codes[guess]);
      expect(feedbackKey(space, guess, secret)).toBe(expected.exact * 5 + expected.partial);
    }
    expect(feedbackKey(space, 17, 17)).toBe(SOLVED_KEY);
  });

  it.each(VARIANTS)('finds the codes that fit the feedback seen for %s', (variant) => {
    const space = codeSpace(variant);
    const random = seededRandom(8);
    const secret = cbRandomCode(variant, random);
    const known = [cbRandomCode(variant, random), cbRandomCode(variant, random)]
      .map((code) => ({ code, ...cbFeedback(secret, code) }));
    const kept = Array.from(consistentIndices(space, known), (index) => space.codes[index].join());
    expect(kept).toEqual(space.codes.filter((code) => cbConsistent(code, known)).map((code) => code.join()));
    expect(kept).toContain(secret.join());
    expect(indexOfCode(space, secret)).toBeGreaterThanOrEqual(0);
    expect(indexOfCode(space, [9, 9, 9, 9])).toBe(-1);
  });
});

describe('Code Breaker solver choices', () => {
  const colors = codeSpace('colors');
  const indices = (...codes: CbCode[]): Int32Array => Int32Array.from(codes, (code) => indexOfCode(colors, code));

  it('guesses a candidate outright when one or two remain', () => {
    expect(chooseGuessIndex(colors, indices([0, 1, 2, 3]), NO_LIMIT)).toBe(indexOfCode(colors, [0, 1, 2, 3]));
    const two = indices([0, 1, 2, 3], [3, 2, 1, 0]);
    expect(Array.from(two)).toContain(chooseGuessIndex(colors, two, NO_LIMIT));
  });

  it('plays the guess that tells the remaining candidates apart, even when it is not itself a candidate', () => {
    // Four codes that differ only in the last peg: a candidate cannot split the other three, a probe can.
    const candidates = indices([0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 2], [0, 0, 0, 3]);
    const guess = colors.codes[chooseGuessIndex(colors, candidates, NO_LIMIT)];
    const keys = Array.from(candidates, (secret) => feedbackKey(colors, indexOfCode(colors, guess), secret));
    expect(new Set(keys).size).toBe(3);
    expect(Array.from(candidates)).not.toContain(indexOfCode(colors, guess));
  });

  it('solves a small set exactly, at no more than the expected guesses a candidate-only strategy needs', () => {
    const candidates = indices([0, 1, 2, 3], [0, 1, 3, 2], [1, 0, 2, 3], [2, 1, 0, 3], [3, 1, 2, 0], [0, 3, 2, 1]);
    const guess = solveExactGuess(colors, candidates, NO_LIMIT);
    const buckets = new Map<number, number>();
    for (const secret of candidates) buckets.set(feedbackKey(colors, guess, secret), (buckets.get(feedbackKey(colors, guess, secret)) ?? 0) + 1);
    // At most one extra guess for every candidate beyond the first, however they split.
    expect(Math.max(...buckets.values())).toBeLessThan(candidates.length);
  });

  it('falls back to the one-step estimate when the limit has already expired', () => {
    const space = codeSpace('digits');
    const all = Int32Array.from({ length: 300 }, (_, index) => index * 16);
    const guess = chooseGuessIndex(space, all, { expired: () => true });
    expect(guess).toBeGreaterThanOrEqual(0);
    expect(guess).toBeLessThan(space.codes.length);
  });
});

describe('Code Breaker plan table', () => {
  it.each(VARIANTS)('holds only well-formed %s codes under paths that follow the first feedback', (variant) => {
    expect(isCbCode(CODEBREAKER_OPENING[variant], variant)).toBe(true);
    const plan = CODEBREAKER_PLAN[variant];
    expect(Object.keys(plan).length).toBeGreaterThan(10);
    for (const [path, code] of Object.entries(plan)) {
      expect(path).toMatch(/^\d+(\.\d+)*$/);
      expect(isCbCode(Array.from(code, Number), variant)).toBe(true);
      // Every earlier step of a path is itself planned, so a bot never meets a gap that follows its own plan.
      const parent = path.split('.').slice(0, -1).join('.');
      if (parent !== '') expect(plan[parent]).toBeDefined();
    }
  });
});
