import { describe, expect, it } from 'vitest';
import type { BlackjackHand, BlackjackLogEntry, Card, Seat } from '@shared/types';
import {
  BJ_STARTING_CHIPS, bjBetSeconds, bjDealerHits, bjDealerMustDraw, bjDealerPeeks, bjIsNatural, bjIsValidBet,
  bjLegalActions, bjMaxBet, bjNextTurn, bjOutcome, bjPayout, bjReplay, bjSettle, bjTotal, bjWinners,
} from '@shared/rules/blackjack';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const hand = (cards: Card[], overrides: Partial<BlackjackHand> = {}): BlackjackHand => ({
  cards, bet: 50, doubled: false, split: false, done: false, ...overrides,
});
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });

describe('Blackjack totals', () => {
  it('counts aces as 11 until that would bust', () => {
    expect(bjTotal([card(14), card(6)])).toEqual({ total: 17, soft: true });
    expect(bjTotal([card(14), card(6), card(10)])).toEqual({ total: 17, soft: false });
    expect(bjTotal([card(14), card(14), card(9)])).toEqual({ total: 21, soft: true });
    expect(bjTotal([card(13), card(12), card(2)])).toEqual({ total: 22, soft: false });
  });

  it('treats only an unsplit two-card 21 as a natural', () => {
    expect(bjIsNatural(hand([card(14), card(13)]))).toBe(true);
    expect(bjIsNatural(hand([card(14), card(13)], { split: true }))).toBe(false);
    expect(bjIsNatural(hand([card(7), card(7), card(7)]))).toBe(false);
  });
});

describe('Blackjack decisions', () => {
  it('limits bets to table steps covered by the chips', () => {
    expect(bjMaxBet(1000)).toBe(200);
    expect(bjMaxBet(95)).toBe(90);
    expect(bjIsValidBet(10, 1000)).toBe(true);
    expect(bjIsValidBet(200, 1000)).toBe(true);
    expect(bjIsValidBet(5, 1000)).toBe(false);
    expect(bjIsValidBet(15, 1000)).toBe(false);
    expect(bjIsValidBet(210, 1000)).toBe(false);
    expect(bjIsValidBet(100, 95)).toBe(false);
    expect(bjBetSeconds(5)).toBe(15);
    expect(bjBetSeconds(20)).toBe(40);
  });

  it('offers double and split only on the first two cards with enough chips, splitting once', () => {
    expect(bjLegalActions([hand([card(8), card(8, 'hearts')])], 0, 50)).toEqual(['hit', 'stand', 'double', 'split']);
    expect(bjLegalActions([hand([card(13), card(10)])], 0, 50)).toContain('split');
    expect(bjLegalActions([hand([card(8), card(8, 'hearts')])], 0, 40)).toEqual(['hit', 'stand']);
    expect(bjLegalActions([hand([card(8), card(3), card(2)])], 0, 500)).toEqual(['hit', 'stand']);
    const split = [hand([card(8), card(8, 'clubs')], { split: true }), hand([card(8, 'hearts'), card(3)], { split: true })];
    expect(bjLegalActions(split, 0, 500)).toEqual(['hit', 'stand', 'double']);
    expect(bjLegalActions([hand([card(9), card(9)], { done: true })], 0, 500)).toEqual([]);
  });

  it('moves turns through unfinished hands in N, E, S, W order', () => {
    const hands = { ...seats<BlackjackHand[]>([]), E: [hand([card(5), card(6)], { done: true })],
      W: [hand([card(5), card(6)]), hand([card(9), card(6)])] };
    expect(bjNextTurn(hands)).toEqual({ seat: 'W', handIndex: 0 });
    hands.W[0].done = true;
    expect(bjNextTurn(hands)).toEqual({ seat: 'W', handIndex: 1 });
    hands.W[1].done = true;
    expect(bjNextTurn(hands)).toBeNull();
  });

  it('lets the dealer peek on aces and tens, stand on soft 17, and skip drawing when nothing is live', () => {
    expect(bjDealerPeeks(card(14))).toBe(true);
    expect(bjDealerPeeks(card(12))).toBe(true);
    expect(bjDealerPeeks(card(9))).toBe(false);
    expect(bjDealerHits([card(14), card(6)])).toBe(false);
    expect(bjDealerHits([card(10), card(6)])).toBe(true);
    const busted = { ...seats<BlackjackHand[]>([]), N: [hand([card(10), card(9), card(5)])] };
    expect(bjDealerMustDraw(busted)).toBe(false);
    const natural = { ...seats<BlackjackHand[]>([]), N: [hand([card(14), card(10)])] };
    expect(bjDealerMustDraw(natural)).toBe(false);
    const live = { ...seats<BlackjackHand[]>([]), N: [hand([card(10), card(7)])] };
    expect(bjDealerMustDraw(live)).toBe(true);
  });
});

describe('Blackjack settlement', () => {
  it('compares hands with the dealer and pays 3:2 for a natural', () => {
    const dealer = [card(10), card(7)];
    expect(bjOutcome(hand([card(14), card(13)]), dealer)).toBe('blackjack');
    expect(bjOutcome(hand([card(10), card(8)]), dealer)).toBe('win');
    expect(bjOutcome(hand([card(10), card(7)]), dealer)).toBe('push');
    expect(bjOutcome(hand([card(10), card(6)]), dealer)).toBe('lose');
    expect(bjOutcome(hand([card(10), card(6), card(9)]), [card(10), card(6), card(9)])).toBe('bust');
    expect(bjOutcome(hand([card(10), card(2)]), [card(10), card(6), card(9)])).toBe('win');
    expect(bjOutcome(hand([card(14), card(13)]), [card(14), card(12)])).toBe('push');
    expect(bjOutcome(hand([card(7), card(7), card(7)]), [card(14), card(12)])).toBe('lose');
    expect(bjPayout(50, 'blackjack')).toBe(125);
    expect(bjPayout(50, 'win')).toBe(100);
    expect(bjPayout(50, 'push')).toBe(50);
    expect(bjPayout(50, 'lose')).toBe(0);
    expect(bjPayout(50, 'bust')).toBe(0);
  });

  it('settles every hand and returns stakes to the chips', () => {
    const settlement = bjSettle({
      hand: 1,
      chips: { N: 950, E: 900, S: 1000, W: 990 },
      hands: { N: [hand([card(14), card(13)])], E: [hand([card(10), card(9)], { bet: 100, doubled: true })],
        S: [], W: [hand([card(10), card(5)], { bet: 10 })] },
      dealer: [card(10), card(8)],
    });
    expect(settlement.outcomes).toEqual({ N: ['blackjack'], E: ['win'], S: [], W: ['lose'] });
    expect(settlement.net).toEqual({ N: 75, E: 100, S: 0, W: -10 });
    expect(settlement.chips).toEqual({ N: 1075, E: 1100, S: 1000, W: 990 });
    expect(bjWinners(settlement.chips)).toEqual(['E']);
    expect(bjWinners(seats(1000))).toEqual(['N', 'E', 'S', 'W']);
  });

  it('replays deals, splits, doubles, dealer draws, and settlements from the public log', () => {
    const log: BlackjackLogEntry[] = [
      { type: 'deal', hand: 1, bets: { N: 50, E: 20, S: 0, W: 0 },
        cards: { N: [card(8), card(8, 'hearts')], E: [card(5), card(6)], S: [], W: [] }, upCard: card(6), timestamp: 1 },
      { type: 'split', seat: 'N', handIndex: 0, cards: [card(3), card(10)], timestamp: 2 },
      { type: 'double', seat: 'N', handIndex: 0, card: card(10, 'hearts'), timestamp: 3 },
      { type: 'stand', seat: 'N', handIndex: 1, timestamp: 4 },
      { type: 'double', seat: 'E', handIndex: 0, card: card(9), timestamp: 5 },
      { type: 'reveal', card: card(10, 'clubs'), timestamp: 6 },
      { type: 'dealerHit', card: card(9, 'clubs'), timestamp: 7 },
    ];
    const beforeSettle = bjReplay(log);
    expect(beforeSettle.chips).toEqual({ N: 850, E: 960, S: 1000, W: 1000 });
    expect(beforeSettle.hands.N.map((value) => [value.cards.length, value.bet, value.done])).toEqual([
      [3, 100, true], [2, 50, true]]);
    expect(beforeSettle.dealer).toHaveLength(3);
    const { outcomes, net, chips } = bjSettle(beforeSettle);
    expect(outcomes).toEqual({ N: ['win', 'win'], E: ['win'], S: [], W: [] });
    log.push({ type: 'settle', hand: 1, outcomes, net, chips, timestamp: 8 });
    expect(bjReplay(log).chips).toEqual({ N: 1150, E: 1040, S: BJ_STARTING_CHIPS, W: BJ_STARTING_CHIPS });
    expect(bjReplay(log, 1).hands.N).toHaveLength(1);
    expect(log[0].type === 'deal' && log[0].cards.N).toHaveLength(2);
  });

  it('gives split aces one card each', () => {
    const table = bjReplay([
      { type: 'deal', hand: 1, bets: { N: 50, E: 0, S: 0, W: 0 },
        cards: { N: [card(14), card(14, 'hearts')], E: [], S: [], W: [] }, upCard: card(6), timestamp: 1 },
      { type: 'split', seat: 'N', handIndex: 0, cards: [card(13), card(5)], timestamp: 2 },
    ]);
    expect(table.hands.N.map((value) => value.done)).toEqual([true, true]);
    expect(bjIsNatural(table.hands.N[0])).toBe(false);
    expect(bjNextTurn(table.hands)).toBeNull();
  });
});
