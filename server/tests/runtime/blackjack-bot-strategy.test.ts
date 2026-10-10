import { describe, expect, it } from 'vitest';
import type { BlackjackHand, BlackjackVisibleState, Card } from '@shared/types';
import { bjLegalActions } from '@shared/rules/blackjack';
import { blackjackBasicStrategy, blackjackBet, getBlackjackBotAction } from '../../src/bots/blackjack-strategy';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const hand = (cards: Card[]): BlackjackHand => ({ cards, bet: 50, doubled: false, split: false, done: false });

function decide(cards: Card[], up: Card['rank'], chips = 1000): string {
  return blackjackBasicStrategy(hand(cards), card(up, 'hearts'), bjLegalActions([hand(cards)], 0, chips));
}

function visible(overrides: Partial<BlackjackVisibleState> = {}): BlackjackVisibleState {
  return {
    gameType: 'blackjack', phase: 'playing', mySeat: 'N', hand: 1,
    chips: { N: 950, E: 950, S: 950, W: 950 }, myBet: null, betPlaced: { N: false, E: false, S: false, W: false },
    betDeadline: null, hands: { N: [hand([card(10), card(6)])], E: [], S: [], W: [] }, dealer: [card(10, 'hearts')],
    holeHidden: true, currentTurnSeat: 'N', activeHand: 0, log: [], result: null, ...overrides,
  };
}

describe('Blackjack bot strategy', () => {
  it('follows basic strategy for hard totals', () => {
    expect(decide([card(10), card(6)], 10)).toBe('hit');
    expect(decide([card(10), card(6)], 6)).toBe('stand');
    expect(decide([card(10), card(2)], 3)).toBe('hit');
    expect(decide([card(10), card(2)], 4)).toBe('stand');
    expect(decide([card(6), card(5)], 10)).toBe('double');
    expect(decide([card(6), card(5)], 14)).toBe('hit');
    expect(decide([card(5), card(4)], 2)).toBe('hit');
    expect(decide([card(10), card(7)], 14)).toBe('stand');
  });

  it('follows basic strategy for soft totals and falls back when doubling is unavailable', () => {
    expect(decide([card(14), card(7)], 4)).toBe('double');
    expect(decide([card(14), card(7)], 7)).toBe('stand');
    expect(decide([card(14), card(7)], 9)).toBe('hit');
    expect(decide([card(14), card(6)], 5)).toBe('double');
    expect(decide([card(14), card(2)], 4)).toBe('hit');
    expect(decide([card(14), card(7)], 4, 0)).toBe('stand');
    expect(decide([card(6), card(5)], 6, 0)).toBe('hit');
    expect(decide([card(14), card(2), card(4)], 5)).toBe('hit');
    expect(decide([card(14), card(3), card(4)], 5)).toBe('stand');
  });

  it('splits aces and eights, never tens, and keeps fives as a hard ten', () => {
    expect(decide([card(14), card(14, 'clubs')], 10)).toBe('split');
    expect(decide([card(8), card(8, 'clubs')], 14)).toBe('split');
    expect(decide([card(10), card(13, 'clubs')], 6)).toBe('stand');
    expect(decide([card(5), card(5, 'clubs')], 6)).toBe('double');
    expect(decide([card(9), card(9, 'clubs')], 7)).toBe('stand');
    expect(decide([card(4), card(4, 'clubs')], 5)).toBe('split');
  });

  it('bets 3–8% of its chips in table steps within the limits', () => {
    expect(blackjackBet(1000, () => 0)).toBe(30);
    expect(blackjackBet(1000, () => 0.999)).toBe(80);
    expect(blackjackBet(5000, () => 0.999)).toBe(200);
    expect(blackjackBet(40, () => 0)).toBe(10);
  });

  it('acts only on its own turn or its own pending bet', () => {
    expect(getBlackjackBotAction(visible(), () => 0.5)).toEqual({ type: 'blackjack-action', action: 'hit' });
    expect(getBlackjackBotAction(visible({ currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
    expect(getBlackjackBotAction(visible({ phase: 'betting' }), () => 0)).toEqual({ type: 'blackjack-bet', amount: 30 });
    expect(getBlackjackBotAction(visible({ phase: 'betting', myBet: 30 }), () => 0)).toBeNull();
    expect(getBlackjackBotAction(visible({ phase: 'betting', chips: { N: 5, E: 0, S: 0, W: 0 } }), () => 0)).toBeNull();
  });
});
