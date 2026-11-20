import { afterEach, describe, expect, it } from 'vitest';
import type { BlackjackHand, BlackjackOptions, BlackjackVisibleState, Card, GameSeat, PlayerInfo } from '@shared/types';
import { bjLegalActions } from '@shared/rules/blackjack';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { actionValues, bestAction, blackjackPlay, dealerDistribution, linearUtility, unseenCounts } from '../../src/bots/blackjack-play';
import { blackjackSearch, standingsUtility } from '../../src/bots/blackjack-search';
import { seededRandom } from '../../src/bots/search/seeded-random';
import type { SearchContext } from '../../src/bots/search/search-types';
import * as blackjack from '../../src/managers/games/blackjack-game';
import { gameSeatValues } from '../helpers/game-seat-values';
import { runSeededGame } from './seeded-game-runner';

const CODE = 'BJSRCH';
const player = (seat: GameSeat): PlayerInfo => ({ id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true });
const players = { N: player('N'), E: player('E'), S: player('S'), W: player('W') };
const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const hand = (cards: Card[], bet = 50, done = true): BlackjackHand => ({ cards, bet, doubled: false, split: false, done });

function context(seed: number): SearchContext {
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs: () => 1_000, expired: () => false } };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A table where seat N holds 10-6 against a ten, and the other seats show the given cards. */
function table(others: readonly Card[][], overrides: Partial<BlackjackVisibleState> = {}): BlackjackVisibleState {
  return gameSeatValues({
    gameType: 'blackjack', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S', 'W'], hand: 1,
    options: { playerDealer: false }, dealerSeat: null, totalHands: 8,
    chips: { N: 950, E: 950, S: 950, W: 950 }, myBet: null, betPlaced: { N: true, E: true, S: true, W: true },
    betDeadline: null,
    hands: { N: [hand([card(10), card(6)], 50, false)], E: [hand(others[0] ?? [])], S: [hand(others[1] ?? [])], W: [hand(others[2] ?? [])] },
    dealer: [card(10, 'hearts')], holeHidden: true, currentTurnSeat: 'N', activeHand: 0, log: [], result: null, ...overrides,
  }) as BlackjackVisibleState;
}

const lows = (suit: Card['suit']): Card[] => [card(2, suit), card(3, suit), card(4, suit), card(5, suit), card(14, suit)];

afterEach(() => blackjack.restoreGames([]));

describe('Blackjack play engine', () => {
  it('is registered for the worker pool with the basic strategy as fallback', () => {
    expect(GAME_BOTS.blackjack.search?.strategy.exportName).toBe('blackjackSearch');
    expect(GAME_BOTS.blackjack.search?.budgetMs).toBeLessThanOrEqual(1500);
  });

  it('counts the unseen cards and keeps the dealer from holding a natural', () => {
    const { counts, total } = unseenCounts(1, [card(10), card(13, 'hearts'), card(14)]);
    expect(total).toBe(49);
    expect(counts[10]).toBe(14);
    expect(counts[1]).toBe(3);
    // With an ace up the hole card cannot be a ten, so a dealer 21 needs three or more cards.
    const aceUp = dealerDistribution(1, counts, total);
    expect(aceUp.reduce((sum, chance) => sum + chance, 0)).toBeCloseTo(1);
  });

  it('plays hard 16 against a ten by the cards left: it hits a full deck but stands once the low cards are gone', () => {
    const fresh = table([[card(9, 'hearts'), card(8, 'hearts')], [card(9, 'clubs'), card(8, 'clubs')], [card(9, 'diamonds'), card(8, 'diamonds')]]);
    expect(blackjackPlay(fresh)).toBe('hit');
    expect(blackjackPlay(table([lows('hearts'), lows('clubs'), lows('diamonds')]))).toBe('stand');
  });

  it('splits and doubles by value and respects what the chips allow', () => {
    const pair = table([], { hands: gameSeatValues({ N: [hand([card(8), card(8, 'clubs')], 50, false)], E: [], S: [], W: [] }) });
    expect(blackjackPlay(pair)).toBe('split');
    const broke = table([], {
      hands: gameSeatValues({ N: [hand([card(8), card(8, 'clubs')], 50, false)], E: [], S: [], W: [] }),
      chips: gameSeatValues({ N: 10, E: 950, S: 950, W: 950 }),
    });
    expect(['hit', 'stand']).toContain(blackjackPlay(broke));
  });

  it('doubles for a large win when only a large win helps the standings', () => {
    const up = card(6, 'hearts');
    const eight = hand([card(5), card(3)], 50, false);
    const { counts, total } = unseenCounts(1, [...eight.cards, up]);
    const legal = bjLegalActions([eight], 0, 900);
    const even = bestAction(actionValues(eight, legal, up, counts, total, linearUtility, 900));
    expect(even).toBe('double');
    const chase = actionValues(eight, legal, up, counts, total, (net) => (net >= 100 ? 1 : 0), 900);
    expect(bestAction(chase)).toBe('double');
    expect(chase.stand).toBe(0);
    expect(chase.hit).toBe(0);
  });

  it('chases a rival on the last hand and protects a lead', () => {
    // The last hand: this seat holds 9 against a 7 and the one rival has finished on 20 with a stake of 100.
    const last = (mine: number, rival: number): BlackjackVisibleState => table([], {
      hand: 8, seats: ['N', 'E'], dealer: [card(7, 'hearts')], chips: gameSeatValues({ N: mine, E: rival, S: 0, W: 0 }),
      hands: gameSeatValues({
        N: [hand([card(5), card(4)], 50, false)], E: [hand([card(10, 'clubs'), card(13, 'clubs')], 100)], S: [], W: [],
      }),
    });
    const level = last(950, 900);
    const ahead = last(1450, 500);
    expect(blackjackPlay(level)).toBe('hit');
    expect(blackjackPlay(level, standingsUtility(level, context(1)))).toBe('double');
    expect(blackjackPlay(ahead, standingsUtility(ahead, context(1)))).toBe('stand');
  });
});

/** Plays one seeded match by the search bot, checking every action is legal and every view stays untouched. */
function playMatch(options: BlackjackOptions, seed: number): { hands: number; actions: number } {
  const random = seededRandom(seed);
  blackjack.startGame(CODE, players, 60_000, 1_000, options, random);
  let step = 0;
  const act = (seat: GameSeat): void => {
    const view = deepFreeze(structuredClone(blackjack.getPlayerVisibleState(CODE, seat)!));
    const action = blackjackSearch(view, context(seed * 1000 + step++));
    if (!action) throw new Error(`${seat} has nothing to do in ${view.phase}`);
    if (action.type === 'blackjack-bet') expect(blackjack.bet(CODE, seat, action.amount, true, 1_500, random)).toEqual({ success: true });
    else if (action.type === 'blackjack-action') expect(blackjack.act(CODE, seat, action.action, 2_000)).toEqual({ success: true });
    else if (action.type === 'blackjack-dealer') expect(blackjack.dealerAct(CODE, seat, action.action, 2_000)).toEqual({ success: true });
    else throw new Error('Unexpected action');
  };
  const actions = runSeededGame('blackjack-search/full', 400, () => blackjack.getGameState(CODE)?.phase === 'scoring', () => {
    const game = blackjack.getGameState(CODE)!;
    if (game.phase === 'betting') {
      blackjack.openBetting(CODE, 1_000);
      for (const seat of blackjack.pendingBetSeats(game)) act(seat);
    } else act(game.currentTurnSeat);
  });
  return { hands: blackjack.getGameState(CODE)!.hand, actions };
}

describe('Blackjack search bot', () => {
  it.each([[{ playerDealer: false }, 1], [{ playerDealer: true }, 3]])(
    'plays whole matches with legal actions, never mutating its view (%j, seed %i)', (options, seed) => {
      const { hands } = playMatch(options, seed);
      expect(hands).toBeGreaterThanOrEqual(options.playerDealer ? 8 : 1);
      expect(blackjack.getGameState(CODE)?.result).not.toBeNull();
    }, 90_000,
  );

  it('decides within its budget', () => {
    const view = table([lows('hearts'), lows('clubs'), lows('diamonds')]);
    const began = performance.now();
    blackjackSearch(view, context(1));
    expect(performance.now() - began).toBeLessThan(500);
  });
});
