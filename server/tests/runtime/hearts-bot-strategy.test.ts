import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { heartsPassError } from '@shared/rules/hearts';
import { getBotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { heartsAction, heartsView } from '../helpers/hearts';
const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const hand = [c('clubs', 2), c('clubs', 14), c('spades', 12), c('spades', 14), c('hearts', 13)];
describe('Hearts bots', () => {
  it.each(['easy', 'hard'] as const)('%s passes exactly three unique held cards, using only the filtered view', (difficulty) => {
    const view = heartsView(hand, { phase: 'passing', currentTurnSeat: null, validCards: [] });
    const before = structuredClone(view);
    for (const sample of [0, 0.3, 0.7, 0.9999]) {
      const action = heartsAction(getBotAction(view, () => sample, difficulty));
      expect(action.type).toBe('pass');
      if (action.type === 'pass') expect(heartsPassError(hand, action.cards)).toBeNull();
    }
    expect(view).toEqual(before);
    expect(getBotAction({ ...view, passedSeats: ['N'] }, () => 0, difficulty)).toBeNull();
  });
  it('hard bot sheds dangerous spades and never relies on observer data', () => {
    const view = heartsView(hand, { phase: 'passing', currentTurnSeat: null, validCards: [] });
    const action = heartsAction(getBotAction(view, () => 0, 'hard'));
    expect(action).toEqual({ type: 'pass', cards: [c('spades', 14), c('spades', 12), c('hearts', 13)] });
    expect(getBotAction({ ...view, observedHands: { E: hand } }, () => 0, 'hard')).toEqual(getBotAction(view, () => 0, 'hard'));
  });
  it('plays under the current winner, dumps penalties when void, and uses legal fallback', () => {
    const follow = heartsView([c('clubs', 3), c('clubs', 8), c('clubs', 14)], {
      trick: { leadSeat: 'W', plays: [{ seat: 'W', card: c('clubs', 10) }] },
    });
    expect(heartsAction(getBotAction(follow, () => 0, 'hard'))).toEqual({ type: 'play', card: c('clubs', 8) });
    const voided = heartsView([c('spades', 12), c('hearts', 14), c('diamonds', 14)], { trick: follow.trick });
    expect(heartsAction(getBotAction(voided, () => 0, 'hard'))).toEqual({ type: 'play', card: c('spades', 12) });
    expect(heartsAction(firstLegalAction(follow))).toEqual({ type: 'play', card: c('clubs', 3) });
    for (const difficulty of ['easy', 'hard'] as const) {
      expect(getBotAction({ ...follow, currentTurnSeat: 'E', validCards: [] }, () => 0, difficulty)).toBeNull();
      expect(getBotAction({ ...follow, phase: 'scoring', validCards: [] }, () => 0, difficulty)).toBeNull();
    }
  });

  it('varies close low leads and equal-risk passes reproducibly without spending clearly worse cards', () => {
    const seeds = Array.from({ length: 64 }, (_, index) => index + 1);
    const visible = heartsView([c('clubs', 3), c('diamonds', 3), c('hearts', 14), c('spades', 12)]);
    const before = structuredClone(visible);
    const choices = seeds.map((seed) => heartsAction(getBotAction(visible, seededRandom(seed), 'hard')));
    expect(new Set(choices.map((choice) => JSON.stringify(choice))).size).toBe(2);
    for (const choice of choices) {
      if (choice.type !== 'play') throw new Error('Expected a Hearts play.');
      expect(choice.card.rank).toBe(3);
    }
    expect(seeds.map((seed) => heartsAction(getBotAction(visible, seededRandom(seed), 'hard')))).toEqual(choices);
    expect(visible).toEqual(before);
    const passing = heartsView([c('clubs', 14), c('diamonds', 14), c('clubs', 13), c('diamonds', 13), c('clubs', 2)],
      { phase: 'passing', currentTurnSeat: null, validCards: [] });
    const passed = seeds.map((seed) => heartsAction(getBotAction(passing, seededRandom(seed), 'hard')));
    const sets = new Set<string>();
    for (const choice of passed) {
      if (choice.type !== 'pass') throw new Error('Expected a Hearts pass.');
      expect(heartsPassError(passing.myHand, choice.cards)).toBeNull();
      expect(choice.cards.filter((card) => card.rank === 14)).toHaveLength(2);
      expect(choice.cards.some((card) => card.rank === 2)).toBe(false);
      sets.add(choice.cards.map((card) => `${card.suit}:${card.rank}`).sort().join(','));
    }
    expect(sets.size).toBe(2);
  });

  it('sheds a dangerous high winner on a clean final play, but ducks when the trick contains penalties', () => {
    const visible = heartsView([c('clubs', 3), c('clubs', 8), c('clubs', 14)], {
      trick: { leadSeat: 'E', plays: [{ seat: 'E', card: c('clubs', 10) }, { seat: 'S', card: c('clubs', 4) },
        { seat: 'W', card: c('clubs', 6) }] },
    });
    const dirty = { ...visible, trick: { ...visible.trick!, plays: [...visible.trick!.plays.slice(0, 2),
      { seat: 'W' as const, card: c('hearts', 2) }] } };
    for (let seed = 1; seed <= 64; seed++) {
      expect(heartsAction(getBotAction(visible, seededRandom(seed), 'hard'))).toEqual({ type: 'play', card: c('clubs', 14) });
      expect(heartsAction(getBotAction(dirty, seededRandom(seed), 'hard'))).toEqual({ type: 'play', card: c('clubs', 8) });
    }
  });
});
