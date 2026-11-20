import { describe, expect, it } from 'vitest';
import { BJ_MAX_BET, BJ_MIN_BET } from '@shared/rules/blackjack';
import { BLACKJACK_CLASSES, BLACKJACK_PLAYER } from '../../src/bots/blackjack-strategy';
import { planRace, SEARCH_RACE, SYNC_RACE } from '../../src/bots/chip-race';
import type { RaceInput } from '../../src/bots/chip-race';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { TENHALF_PLAYER } from '../../src/bots/tenhalf-strategy';

const house = (chips: readonly number[], hands: number): RaceInput => ({
  player: BLACKJACK_PLAYER, chips, me: 0, dealers: Array<number>(hands).fill(-1),
});

/** Seats take turns dealing from `first`, as in a player-dealer or Ten and a Half match. */
const rotating = (chips: readonly number[], hands: number, first: number): RaceInput => ({
  player: TENHALF_PLAYER, chips, me: 0, dealers: Array.from({ length: hands }, (_, hand) => (first + hand) % chips.length),
});

describe('chip race planner', () => {
  it('bets the most when trailing on the last hand and the least when far ahead', () => {
    expect(planRace(house([800, 1000, 900, 950], 1), seededRandom(1)).bet).toBe(BJ_MAX_BET);
    expect(planRace(house([1500, 1000, 900, 950], 1), seededRandom(1)).bet).toBe(BJ_MIN_BET);
  });

  it('bets big when many hands remain, since only the largest stack wins', () => {
    expect(planRace(house([1000, 1000, 1000, 1000], 8), seededRandom(1)).bet).toBeGreaterThanOrEqual(100);
  });

  it('values stacks monotonically and as chances', () => {
    const plan = planRace(house([1000, 1000, 1000], 4), seededRandom(2));
    for (const hands of [0, 1, 4]) {
      let last = 0;
      for (let chips = 0; chips <= 2400; chips += 100) {
        const value = plan.value(hands, chips);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(value).toBeGreaterThanOrEqual(last - 0.02);
        last = value;
      }
    }
    expect(plan.value(0, 3000)).toBeGreaterThan(plan.value(0, 500));
  });

  it('places no stake in a hand this seat deals, and none without chips', () => {
    expect(planRace(rotating([1000, 1000, 1000, 1000], 8, 0), seededRandom(1)).bet).toBeNull();
    expect(planRace(house([5, 1000, 1000], 3), seededRandom(1)).bet).toBeNull();
  });

  it('is deterministic for a seed and keeps every stake legal', () => {
    for (const options of [SYNC_RACE, SEARCH_RACE]) {
      const input = { ...rotating([700, 1000, 1200, 900], 8, 1), firstStakes: undefined };
      const first = planRace(input, seededRandom(7), options);
      const second = planRace(input, seededRandom(7), options);
      expect(first.bet).toBe(second.bet);
      expect(first.bet! % 10).toBe(0);
      expect(first.bet).toBeGreaterThanOrEqual(BJ_MIN_BET);
      expect(first.bet).toBeLessThanOrEqual(BJ_MAX_BET);
      expect(first.stakes.map((stake) => stake.bet)).toEqual(Array.from({ length: 20 }, (_, index) => 10 * (index + 1)));
    }
  });

  it('replays against rivals that share the dealer and bank without a bet of its own', () => {
    const input: RaceInput = { ...house([900, 1000, 1000, 1000], 6), classes: BLACKJACK_CLASSES };
    const plan = planRace(input, seededRandom(3), SEARCH_RACE);
    expect(plan.stakes.every((stake) => stake.value >= 0 && stake.value <= 1)).toBe(true);
    expect(plan.stakes.find((stake) => stake.bet === plan.bet)!.value).toBe(Math.max(...plan.stakes.map((stake) => stake.value)));
  });

  it('plans against a field of any size', () => {
    for (const seats of [2, 3, 5, 8]) {
      const chips = Array<number>(seats).fill(1000);
      const began = performance.now();
      const plan = planRace(rotating(chips, seats * 2, 1), seededRandom(seats), SEARCH_RACE);
      expect(plan.bet).not.toBeNull();
      expect(performance.now() - began).toBeLessThan(1_500);
    }
  });
});
