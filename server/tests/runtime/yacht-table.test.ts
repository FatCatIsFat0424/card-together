import { describe, expect, it } from 'vitest';
import {
  EMPTY_YACHT_SCORECARD, YACHT_BOXES, YACHT_MAX_ROLLS, yachtLegalBoxes, yachtReroll, yachtRollDice, yachtTotals, yachtWrite,
} from '@shared/rules/yacht';
import type { YachtBox, YachtFace, YachtScorecard } from '@shared/rules/yacht';
import type { YachtVisibleState } from '@shared/games/yacht/types';
import { FULL_MASK, YACHT_STATE_COUNT, cardState, forEachState, stateIndex } from '../../src/bots/yacht-states';
import { YACHT_TABLE_BYTES, yachtFutureMean, yachtFutureSpread } from '../../src/bots/yacht-table';
import { getYachtBotAction } from '../../src/bots/yacht-strategy';
import { yachtPlan } from '../../src/bots/yacht-lookahead';
import { normalCdf, yachtWinChance } from '../../src/bots/yacht-win';
import { readFileSync } from 'node:fs';
import { YACHT_TABLE_PATH } from '../../src/bots/yacht-table';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const card = (boxes: Partial<Record<YachtBox, number>>, extraYachts = 0): YachtScorecard => ({ boxes, extraYachts });
const future = (value: YachtScorecard): number => {
  const { mask, flag, subtotal } = cardState(value);
  return yachtFutureMean(mask, flag, subtotal);
};

/** Fills every box except `open` with scores that keep the upper subtotal at `upper`, from the ones up. */
function cardWithOpen(open: readonly YachtBox[], upper: number, yacht = 50): YachtScorecard {
  const boxes: Partial<Record<YachtBox, number>> = {};
  let left = upper;
  YACHT_BOXES.forEach((box, index) => {
    if (open.includes(box)) return;
    if (box === 'yacht') boxes[box] = yacht;
    else if (index < 6) {
      const score = Math.min(5, Math.floor(left / (index + 1))) * (index + 1);
      boxes[box] = score;
      left -= score;
    } else boxes[box] = 0;
  });
  return card(boxes);
}

/**
 * Optimal expected points still to come from a card, found by brute force over every dice sequence and every
 * set of held positions, scoring only through the shared rules.
 */
function bruteFuture(start: YachtScorecard): number {
  const memo = new Map<string, number>();
  const key = (value: YachtScorecard): string => `${YACHT_BOXES.map((box) => value.boxes[box] ?? '-').join(',')}`;
  const sortedKey = (dice: readonly number[]): number => dice.reduce((total, die) => total + 6 ** (die - 1), 0);

  const futureOf = (value: YachtScorecard): number => {
    if (YACHT_BOXES.every((box) => value.boxes[box] !== undefined)) return 0;
    const cached = memo.get(key(value));
    if (cached !== undefined) return cached;
    const before = yachtTotals(value).total;
    const stopValue = new Map<number, number>();
    const stopAt = (dice: readonly YachtFace[]): number => {
      const id = sortedKey(dice);
      let best = stopValue.get(id);
      if (best === undefined) {
        best = Number.NEGATIVE_INFINITY;
        for (const box of yachtLegalBoxes(value, dice)) {
          const next = yachtWrite(value, box, dice)!;
          best = Math.max(best, yachtTotals(next).total - before + futureOf(next));
        }
        stopValue.set(id, best);
      }
      return best;
    };
    const rolled = new Map<number, number>();
    const facesOf = (counts: readonly number[]): YachtFace[] => counts.flatMap((count, face) => Array<YachtFace>(count).fill((face + 1) as YachtFace));
    /** Average of `afterRoll` over every sequence of `free` new dice added to `counts`. */
    const averageOver = (counts: number[], free: number, rolls: number): number => {
      if (free === 0) return afterRoll(counts, rolls);
      let total = 0;
      for (let face = 0; face < 6; face += 1) {
        counts[face] += 1;
        total += averageOver(counts, free - 1, rolls);
        counts[face] -= 1;
      }
      return total / 6;
    };
    const afterRoll = (counts: readonly number[], rolls: number): number => {
      const id = counts.reduce((total, count) => total * 6 + count, 0) * 4 + rolls;
      const cachedValue = rolled.get(id);
      if (cachedValue !== undefined) return cachedValue;
      const sorted = facesOf(counts);
      let best = stopAt(sorted);
      if (rolls < YACHT_MAX_ROLLS) {
        const seen = new Set<string>();
        for (let held = 0; held < 31; held += 1) {
          const kept = sorted.filter((_, index) => held & (1 << index));
          const signature = kept.join('');
          if (seen.has(signature)) continue;
          seen.add(signature);
          const keptCounts = [0, 0, 0, 0, 0, 0];
          for (const die of kept) keptCounts[die - 1] += 1;
          best = Math.max(best, averageOver(keptCounts, 5 - kept.length, rolls + 1));
        }
      }
      rolled.set(id, best);
      return best;
    };
    const total = averageOver([0, 0, 0, 0, 0, 0], 5, 1) * 6 ** 5;
    const result = total / 6 ** 5;
    memo.set(key(value), result);
    return result;
  };
  return futureOf(start);
}

describe('Yacht Dice solitaire table', () => {
  it('has the size the state layout needs and indexes every state once', () => {
    expect(readFileSync(YACHT_TABLE_PATH).length).toBe(YACHT_TABLE_BYTES);
    const seen = new Uint8Array(YACHT_STATE_COUNT);
    let mismatches = 0;
    forEachState((mask, flag, subtotal, index) => {
      if (stateIndex(mask, flag, subtotal) !== index) mismatches += 1;
      seen[index] += 1;
    });
    expect(mismatches).toBe(0);
    expect(seen.every((count) => count === 1)).toBe(true);
  });

  it('is worth the known optimum of solitaire Yahtzee scoring at the start and nothing at the end', () => {
    // The published optimum is 254.59; here a Yacht written as 0 gives up the joker rule, which costs about 0.1.
    expect(future(EMPTY_YACHT_SCORECARD)).toBeGreaterThan(254.3);
    expect(future(EMPTY_YACHT_SCORECARD)).toBeLessThan(254.6);
    expect(yachtFutureSpread(0, 0, 0)).toBeGreaterThan(55);
    const { mask, flag, subtotal } = cardState(cardWithOpen([], 63));
    expect(mask).toBe(FULL_MASK);
    expect(yachtFutureMean(mask, flag, subtotal)).toBe(0);
    expect(yachtFutureSpread(mask, flag, subtotal)).toBe(0);
  });

  it('matches a brute-force solution on cards with one or two boxes left', () => {
    const cases: [readonly YachtBox[], number, number?][] = [
      [['chance'], 63], [['yacht'], 63], [['sixes'], 57], [['fullHouse'], 63, 0], [['fourKind', 'threes'], 60],
      [['fives', 'sixes'], 40],
    ];
    for (const [open, upper, yacht] of cases) {
      const value = cardWithOpen(open, upper, yacht);
      expect(future(value), `${open.join('+')} upper ${upper}`).toBeCloseTo(bruteFuture(value), 1);
    }
  }, 120_000);

  it('values a Yacht already scored above the same card with a zero in the Yacht box', () => {
    const scored = cardWithOpen(['fourKind', 'chance'], 63, 50);
    const zero = cardWithOpen(['fourKind', 'chance'], 63, 0);
    expect(future(scored)).toBeGreaterThan(future(zero));
  });
});

describe('Yacht Dice win chance', () => {
  it('approximates the normal distribution and rises with the total', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    const chance = yachtWinChance([{ mean: 250, spread: 30 }]);
    expect(chance(250, 0)).toBeCloseTo(0.5, 1);
    expect(chance(300, 10)).toBeGreaterThan(chance(260, 10));
    expect(chance(200, 10)).toBeLessThan(0.1);
  });

  it('turns the odds into risk taking: a longer shot is worth more when far behind than when far ahead', () => {
    const chance = yachtWinChance([{ mean: 250, spread: 10 }]);
    // Two outcomes with the same mean, one safe and one spread out.
    const gamble = (mean: number): number => chance(mean, 40) - chance(mean, 0);
    expect(gamble(200)).toBeGreaterThan(0.05);
    expect(gamble(300)).toBeLessThan(-0.05);
  });

  it('chases a long shot when a rival is out of reach of the safe play', () => {
    // Large Straight and Chance are open. Alone, the bot keeps four dice for Chance and a Large Straight draw.
    const open = cardWithOpen(['largeStraight', 'chance'], 63, 0);
    const behind = yachtTotals(open).total + 30;
    const dice = [1, 2, 3, 4, 6] as YachtFace[];
    expect(yachtPlan(open, dice, 1).held).toEqual([false, true, true, true, true]);
    expect(yachtPlan(open, dice, 1, [{ mean: behind, spread: 1 }]).held).not.toEqual([false, true, true, true, true]);
    // Out of reach for good, the plan falls back to the best expected score.
    expect(yachtPlan(open, dice, 1, [{ mean: 900, spread: 1 }]).held).toEqual([false, true, true, true, true]);
  });
});

describe('Yacht Dice solitaire play', () => {
  /** One full solitaire game through the bot's own action choice; `strict` also hands it a deep-frozen view. */
  function solo(seed: number, strict: boolean): number {
    const random = seeded(seed);
    let current: YachtScorecard = EMPTY_YACHT_SCORECARD;
    for (let round = 1; round <= 13; round += 1) {
      let dice: YachtFace[] = [];
      let held = [false, false, false, false, false];
      let rolls = 0;
      for (let step = 0; step < 10; step += 1) {
        const view = {
          gameType: 'yacht', phase: 'playing', mySeat: 'N', seats: ['N', 'S'], options: { mode: 'turns' }, round,
          currentTurnSeat: 'N', roundDeadline: null,
          turns: { N: { dice, held, rolls, done: false }, S: { dice: [], held, rolls: 0, done: false } },
          cards: { N: current, S: EMPTY_YACHT_SCORECARD }, log: [], result: null,
        };
        // Frozen views throw on any write; the equality check catches changes to shared inner objects too.
        const visible = (strict ? deepFreeze(structuredClone(view)) : view) as unknown as YachtVisibleState;
        const action = getYachtBotAction(visible);
        if (strict) expect(visible).toEqual(view);
        if (action?.type !== 'game-action' || action.request.gameType !== 'yacht') throw new Error('Expected a Yacht Dice action');
        const request = action.request.action;
        if (request.type === 'roll') {
          if (rolls >= YACHT_MAX_ROLLS || request.held?.every(Boolean)) throw new Error('Illegal roll');
          dice = rolls === 0 ? yachtRollDice(5, random) : yachtReroll(dice, request.held ?? held, random);
          held = request.held ? [...request.held] : [false, false, false, false, false];
          rolls += 1;
        } else if (request.type === 'score') {
          const next = yachtWrite(current, request.box, dice);
          if (!next) throw new Error(`Illegal box ${request.box}`);
          current = next;
          break;
        } else throw new Error('Unexpected action');
      }
    }
    expect(YACHT_BOXES.every((box) => current.boxes[box] !== undefined)).toBe(true);
    return yachtTotals(current).total;
  }

  function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  }

  it('plays legal turns on a frozen view and averages near the solitaire optimum', () => {
    for (let seed = 1; seed <= 20; seed += 1) solo(seed, true);
    let total = 0;
    const games = 2000;
    for (let seed = 1; seed <= games; seed += 1) total += solo(seed, false);
    // The optimum is 254.5 with a spread of 60 per game, so 2000 games pin the average to within about 1.4.
    expect(total / games).toBeGreaterThan(250);
  }, 300_000);
});
