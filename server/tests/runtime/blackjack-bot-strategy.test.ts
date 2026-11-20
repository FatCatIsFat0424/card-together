import { gameSeatValues } from '../helpers/game-seat-values';
import { describe, expect, it } from 'vitest';
import type { BlackjackHand, BlackjackVisibleState, Card } from '@shared/types';
import { BJ_BET_STEP, BJ_MAX_BET, BJ_MIN_BET, bjLegalActions } from '@shared/rules/blackjack';
import { blackjackBasicStrategy, blackjackBet, getBlackjackBotAction } from '../../src/bots/blackjack-strategy';
import { seededRandom } from '../../src/bots/search/seeded-random';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const hand = (cards: Card[]): BlackjackHand => ({ cards, bet: 50, doubled: false, split: false, done: false });

function decide(cards: Card[], up: Card['rank'], chips = 1000): string {
  return blackjackBasicStrategy(hand(cards), card(up, 'hearts'), bjLegalActions([hand(cards)], 0, chips));
}

function visible(overrides: Partial<BlackjackVisibleState> = {}): BlackjackVisibleState {
  return gameSeatValues({
    gameType: 'blackjack', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S', 'W'], hand: 1,
    options: { playerDealer: false }, dealerSeat: null, totalHands: 8,
    chips: { N: 950, E: 950, S: 950, W: 950 }, myBet: null, betPlaced: { N: false, E: false, S: false, W: false },
    betDeadline: null, hands: { N: [hand([card(10), card(6)])], E: [], S: [], W: [] }, dealer: [card(10, 'hearts')],
    holeHidden: true, currentTurnSeat: 'N', activeHand: 0, log: [], result: null, ...overrides,
  });
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

  it('bets legal amounts in table steps whatever the standings', () => {
    for (const [mine, hand, random] of [[1000, 0, 0], [1000, 4, 0.5], [35, 7, 0.9], [5000, 0, 0.999], [10, 3, 0.2]] as const) {
      const betting = visible(gameSeatValues({ phase: 'betting', hand, chips: { N: mine, E: 1000, S: 900, W: 1200 } }));
      const amount = blackjackBet(betting, () => random);
      expect(amount % BJ_BET_STEP).toBe(0);
      expect(amount).toBeGreaterThanOrEqual(BJ_MIN_BET);
      expect(amount).toBeLessThanOrEqual(Math.min(BJ_MAX_BET, mine));
    }
  });

  it('bets big early, bold when trailing and small when leading on the last hand', () => {
    const late = (hand: number, mine: number): BlackjackVisibleState =>
      visible(gameSeatValues({ phase: 'betting', hand, chips: { N: mine, E: 1000, S: 900, W: 800 } }));
    // Only the largest final stack wins, so variance is worth more than the small edge it costs.
    expect(blackjackBet(late(0, 1000), seededRandom(1))).toBeGreaterThanOrEqual(100);
    expect(blackjackBet(late(7, 900), seededRandom(1))).toBe(200);
    expect(blackjackBet(late(7, 1500), seededRandom(1))).toBe(10);
  });

  it('plans the same stake from the same view and seed', () => {
    const betting = visible(gameSeatValues({ phase: 'betting', hand: 3, chips: { N: 880, E: 1000, S: 900, W: 1100 } }));
    expect(blackjackBet(betting, seededRandom(4))).toBe(blackjackBet(betting, seededRandom(4)));
  });

  it('acts only on its own turn or its own pending bet', () => {
    expect(getBlackjackBotAction(visible(), () => 0.5)).toEqual({ type: 'blackjack-action', action: 'hit' });
    expect(getBlackjackBotAction(visible({ currentTurnSeat: 'E' }), () => 0.5)).toBeNull();
    expect(getBlackjackBotAction(visible({ phase: 'betting' }), () => 0)).toMatchObject({ type: 'blackjack-bet' });
    expect(getBlackjackBotAction(visible({ phase: 'betting', myBet: 30 }), () => 0)).toBeNull();
    expect(getBlackjackBotAction(visible(gameSeatValues({ phase: 'betting', chips: { N: 5, E: 0, S: 0, W: 0 } })), () => 0)).toBeNull();
  });
});
