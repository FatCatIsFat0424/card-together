import { beforeEach, describe, expect, it } from 'vitest';
import type { BlackjackGameState, Card, PlayerInfo, Seat } from '@shared/types';
import { BJ_HANDS } from '@shared/rules/blackjack';
import { createDeck } from '../../src/engine/deck';
import * as blackjack from '../../src/managers/games/blackjack-game';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'BJ0001';
const BET_MS = 15_000;
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const key = (value: Card): string => `${value.suit}${value.rank}`;

/**
 * A random source that makes the Fisher-Yates shuffle put `top` first, in order. Deal order is each
 * bettor's first card (N, E, S, W), the up card, each bettor's second card, the hole card, then draws.
 */
function rigged(top: readonly Card[]): () => number {
  const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
  const target = [...top, ...rest];
  const deck = createDeck();
  const draws: number[] = [];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = deck.findIndex((value) => key(value) === key(target[i]));
    draws.push((j + 0.5) / (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let index = 0;
  return () => draws[index++];
}

function game(): BlackjackGameState {
  const state = blackjack.getGameState(CODE);
  if (!state) throw new Error('Expected a Blackjack game');
  return state;
}

/** Every seat that owes a bet stakes `amounts[seat]` (default 50); the last bet deals `top`. */
function betAll(top: readonly Card[], amounts: Partial<Record<Seat, number>> = {}): void {
  const pending = blackjack.pendingBetSeats(game());
  const random = rigged(top);
  for (const seat of pending) {
    expect(blackjack.bet(CODE, seat, amounts[seat] ?? 50, true, 1000, random)).toEqual({ success: true });
  }
}

describe('Blackjack gameplay', () => {
  beforeEach(() => {
    blackjack.restoreGames([]);
    blackjack.startGame(CODE, PLAYERS, BET_MS, 1000);
  });

  it('opens a shared betting window with equal chips and no cards', () => {
    expect(game()).toMatchObject({ phase: 'betting', hand: 0, betDeadline: 1000 + BET_MS, deck: [], dealer: [],
      chips: { N: 1000, E: 1000, S: 1000, W: 1000 }, bets: { N: null, E: null, S: null, W: null } });
    expect(blackjack.pendingBetSeats(game())).toEqual(SEATS);
  });

  it('rejects malformed, repeated, and late bets without changes', () => {
    const before = structuredClone(game());
    for (const amount of [0, 5, 15, 210, 50.5]) expect(blackjack.bet(CODE, 'N', amount, false, 1000).success).toBe(false);
    expect(blackjack.bet(CODE, 'N', 50, false, 1000 + BET_MS).success).toBe(false);
    expect(game()).toEqual(before);
    expect(blackjack.bet(CODE, 'N', 50, false, 1000).success).toBe(true);
    expect(blackjack.bet(CODE, 'N', 50, false, 1000).success).toBe(false);
    expect(blackjack.bet(CODE, 'E', 50, true, 1000 + BET_MS).success).toBe(true);
  });

  it('hides other bets until the deal and marks only human bets made at the deadline', () => {
    blackjack.restoreGames([]);
    blackjack.startGame(CODE, { ...PLAYERS, W: { ...PLAYERS.W, id: 'bot:w', isBot: true } }, BET_MS, 1000);
    expect(blackjack.bet(CODE, 'N', 120, false, 1000).success).toBe(true);
    expect(blackjack.bet(CODE, 'E', 10, true, 1000).success).toBe(true);
    expect(blackjack.bet(CODE, 'W', 30, true, 1000).success).toBe(true);
    const view = blackjack.getPlayerVisibleState(CODE, 'S')!;
    expect(view.myBet).toBeNull();
    expect(view.betPlaced).toEqual({ N: true, E: true, S: false, W: true });
    expect(view).not.toHaveProperty('bets');
    expect(view).not.toHaveProperty('deck');
    expect(view).not.toHaveProperty('hole');
    expect(blackjack.getPlayerVisibleState(CODE, 'N')!.myBet).toBe(120);
    expect(game().log.map((entry) => entry.type === 'bet' && [entry.seat, entry.auto])).toEqual([
      ['N', false], ['E', true], ['W', false]]);
  });

  it('deals two public cards to each bettor, keeps the hole card private, and stakes the bets', () => {
    betAll([card(2), card(3), card(4), card(5), card(9, 'hearts'), card(10), card(10, 'hearts'), card(10, 'clubs'),
      card(10, 'diamonds'), card(7, 'hearts')], { N: 100 });
    const state = game();
    expect(state).toMatchObject({ phase: 'playing', hand: 1, currentTurnSeat: 'N', activeHand: 0,
      chips: { N: 900, E: 950, S: 950, W: 950 }, dealer: [card(9, 'hearts')], hole: card(7, 'hearts'),
      bets: { N: null, E: null, S: null, W: null }, betDeadline: null });
    expect(state.hands.N[0].cards).toEqual([card(2), card(10)]);
    const view = blackjack.getPlayerVisibleState(CODE, 'E')!;
    expect(view.holeHidden).toBe(true);
    expect(view.dealer).toEqual([card(9, 'hearts')]);
    expect(view.hands.N[0].bet).toBe(100);
    expect(state.log.at(-1)).toMatchObject({ type: 'deal', hand: 1, bets: { N: 100, E: 50, S: 50, W: 50 } });
  });

  it('ends the hand at once when the dealer peeks at a blackjack, pushing only naturals', () => {
    betAll([card(14), card(3), card(4), card(5), card(14, 'hearts'), card(13), card(10, 'hearts'), card(10, 'clubs'),
      card(10, 'diamonds'), card(12, 'hearts')]);
    const state = game();
    expect(state.phase).toBe('betting');
    expect(state.betDeadline).toBeNull();
    expect(state.log.slice(-2).map((entry) => entry.type)).toEqual(['reveal', 'settle']);
    expect(state.log.at(-1)).toMatchObject({ outcomes: { N: ['push'], E: ['lose'], S: ['lose'], W: ['lose'] },
      net: { N: 0, E: -50, S: -50, W: -50 } });
    expect(state.chips).toEqual({ N: 1000, E: 950, S: 950, W: 950 });
    blackjack.openBetting(CODE, 5000);
    expect(game().betDeadline).toBe(5000 + BET_MS);
  });

  it('enforces turns and legal actions, advancing past busted and doubled hands', () => {
    betAll([card(10), card(5), card(9), card(8), card(6, 'hearts'), card(6), card(6, 'clubs'), card(9, 'clubs'),
      card(8, 'clubs'), card(10, 'hearts'), card(12), card(3), card(2, 'hearts')]);
    expect(blackjack.act(CODE, 'E', 'hit').success).toBe(false);
    expect(blackjack.act(CODE, 'N', 'split').success).toBe(false);
    expect(blackjack.act(CODE, 'N', 'hit').success).toBe(true);
    expect(game().hands.N[0]).toMatchObject({ done: true });
    expect(game().currentTurnSeat).toBe('E');
    expect(blackjack.act(CODE, 'E', 'double').success).toBe(true);
    expect(game().hands.E[0]).toMatchObject({ bet: 100, doubled: true, done: true, cards: [card(5), card(6, 'clubs'), card(3)] });
    expect(game().chips.E).toBe(900);
    expect(blackjack.act(CODE, 'S', 'hit').success).toBe(true);
    expect(game().currentTurnSeat).toBe('S');
    expect(blackjack.act(CODE, 'S', 'double').success).toBe(false);
    expect(blackjack.act(CODE, 'S', 'stand').success).toBe(true);
    expect(game().currentTurnSeat).toBe('W');
  });

  it('splits a pair into two hands played in order and gives split aces one card each', () => {
    betAll([card(8), card(14), card(10), card(10, 'hearts'), card(6), card(8, 'hearts'), card(14, 'hearts'),
      card(9), card(9, 'hearts'), card(10, 'clubs'), card(3), card(13), card(5), card(7)]);
    expect(blackjack.act(CODE, 'N', 'split').success).toBe(true);
    expect(game().hands.N.map((value) => value.cards)).toEqual([[card(8), card(3)], [card(8, 'hearts'), card(13)]]);
    expect(game().chips.N).toBe(900);
    expect(blackjack.act(CODE, 'N', 'split').success).toBe(false);
    expect(blackjack.act(CODE, 'N', 'double').success).toBe(true);
    expect(game()).toMatchObject({ currentTurnSeat: 'N', activeHand: 1 });
    expect(blackjack.act(CODE, 'N', 'stand').success).toBe(true);
    expect(game().currentTurnSeat).toBe('E');
    expect(blackjack.act(CODE, 'E', 'split').success).toBe(true);
    expect(game().hands.E.map((value) => value.done)).toEqual([true, true]);
    expect(game().currentTurnSeat).toBe('S');
  });

  it('draws the dealer to 17, standing on soft 17, and pays every outcome', () => {
    betAll([card(14), card(10), card(10, 'hearts'), card(9), card(14, 'hearts'), card(13), card(8),
      card(7, 'hearts'), card(12), card(2), card(4)]);
    expect(game().hands.N[0].done).toBe(true);
    expect(blackjack.act(CODE, 'E', 'stand').success).toBe(true);
    expect(blackjack.act(CODE, 'S', 'stand').success).toBe(true);
    expect(blackjack.act(CODE, 'W', 'stand').success).toBe(true);
    const state = game();
    expect(state.dealer).toEqual([card(14, 'hearts'), card(2), card(4)]);
    expect(state.log.at(-1)).toMatchObject({ type: 'settle',
      outcomes: { N: ['blackjack'], E: ['win'], S: ['push'], W: ['win'] } });
    expect(state.chips).toEqual({ N: 1075, E: 1050, S: 1000, W: 1050 });
    expect(state.phase).toBe('betting');
  });

  it('skips the dealer draw when every hand busted', () => {
    betAll([card(10), card(10, 'hearts'), card(10, 'clubs'), card(10, 'diamonds'), card(6), card(12), card(12, 'hearts'),
      card(12, 'clubs'), card(12, 'diamonds'), card(9), card(13), card(13, 'hearts'), card(13, 'clubs'), card(13, 'diamonds')]);
    for (const seat of SEATS) expect(blackjack.act(CODE, seat, 'hit').success).toBe(true);
    expect(game().dealer).toEqual([card(6), card(9)]);
    expect(game().chips).toEqual({ N: 950, E: 950, S: 950, W: 950 });
  });

  it('seats without the minimum sit out, and the match ends after the last hand', () => {
    game().chips.W = 5;
    expect(blackjack.pendingBetSeats(game())).toEqual(['N', 'E', 'S']);
    expect(blackjack.bet(CODE, 'W', 10, true, 1000).success).toBe(false);
    for (let hand = 1; hand <= BJ_HANDS; hand++) {
      blackjack.openBetting(CODE, 1000);
      betAll([card(10), card(10, 'hearts'), card(10, 'clubs'), card(9), card(9, 'hearts'), card(9, 'clubs'),
        card(10, 'diamonds'), card(8, 'diamonds')]);
      expect(game().hands.W).toEqual([]);
      for (const seat of ['N', 'E', 'S'] as const) expect(blackjack.act(CODE, seat, 'stand').success).toBe(true);
    }
    const state = game();
    expect(state.phase).toBe('scoring');
    expect(state.result).toEqual({ gameType: 'blackjack', chips: state.chips, hands: BJ_HANDS,
      winners: ['N', 'E', 'S'] });
    expect(state.chips).toEqual({ N: 1400, E: 1400, S: 1400, W: 5 });
  });
});
