import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { heartsPassError } from '@shared/rules/hearts';
import { getBotAction } from '../../src/bots/bot-decisions';
import { firstLegalAction } from '../../src/runtime/automated-action';
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
});
