import { gameSeatValues } from '../helpers/game-seat-values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import type { Card, GameSeat, HoldemAction, HoldemLogEntry, HoldemVisibleState, PlayerInfo, Seat } from '@shared/types';
import { heLegalActions } from '@shared/rules/holdem';
import { createDeck } from '../../src/engine/deck';
import * as holdem from '../../src/managers/games/holdem-game';
import { GAME_BOTS } from '../../src/bots/bot-registry';
import { buildContext } from '../../src/bots/holdem-context';
import { FAST_EFFORT } from '../../src/bots/holdem-equity';
import { opponentModels } from '../../src/bots/holdem-opponents';
import { holdemSearch } from '../../src/bots/holdem-search';
import { getHoldemBotAction, holdemEquity } from '../../src/bots/holdem-strategy';
import type { SearchContext } from '../../src/bots/search/search-types';
import { seededRandom } from '../../src/bots/search/seeded-random';
import { runSeededGame } from './seeded-game-runner';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });
const blinds = { N: 10, E: 20, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const handEntry = (hand: number, bigBlind = 20): HoldemLogEntry =>
  ({ type: 'hand', hand, button: 'W', smallBlind: bigBlind / 2, bigBlind, blinds: { ...blinds, N: bigBlind / 2, E: bigBlind }, timestamp: 0 });
const actionEntry = (seat: GameSeat, kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): HoldemLogEntry =>
  ({ type: 'action', seat, action: kind, to, allIn, timestamp: 0 });
const streetEntry = (street: 'flop' | 'turn' | 'river', cards: Card[]): HoldemLogEntry => ({ type: 'street', street, cards, timestamp: 0 });

/**
 * Preflop with W on the button: N posted the small blind, E the big blind, and S acts first with three seats behind.
 */
function visible(overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState {
  return gameSeatValues({
    gameType: 'holdem', phase: 'playing', mySeat: 'S', seats: ['N', 'E', 'S', 'W'], myHand: [card(2), card(7, 'hearts')], hand: 1, button: 'W',
    smallBlind: 10, bigBlind: 20, chips: { N: 990, E: 980, S: 1000, W: 1000 },
    streetBets: { N: 10, E: 20, S: 0, W: 0 }, totalBets: { N: 10, E: 20, S: 0, W: 0 },
    dealt: ['N', 'E', 'S', 'W'], folded: [], street: 'preflop', board: [], currentBet: 20, minRaise: 20, acted: [],
    revealed: seats([]), eliminated: [], currentTurnSeat: 'S', log: [handEntry(1)], result: null, ...overrides,
  });
}

function action(state: HoldemVisibleState, random: () => number = seededRandom(1)): HoldemAction | null {
  const decided = getHoldemBotAction(state, random);
  return decided?.type === 'holdem-action' ? decided.action : null;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const shareOf = (state: HoldemVisibleState, type: HoldemAction['type']): number =>
  SEEDS.filter((seed) => action(state, seededRandom(seed))?.type === type).length / SEEDS.length;

/** Hands from strong to weak, used to compare how wide two situations play. */
const SAMPLE_HANDS: readonly (readonly [Card, Card])[] = [
  [card(14), card(10, 'hearts')], [card(14), card(6, 'hearts')], [card(14), card(2, 'hearts')], [card(13), card(11, 'hearts')],
  [card(13), card(8, 'hearts')], [card(13), card(4)], [card(12), card(10)], [card(12), card(7, 'hearts')], [card(11), card(9)],
  [card(11), card(6, 'hearts')], [card(10), card(8)], [card(9), card(9, 'hearts')], [card(6), card(6, 'hearts')], [card(3), card(3, 'hearts')],
  [card(9), card(7)], [card(8), card(6)], [card(7), card(5)], [card(10), card(7, 'hearts')], [card(9), card(5, 'hearts')],
  [card(8), card(4, 'hearts')], [card(6), card(3, 'hearts')], [card(5), card(4)], [card(12), card(3)], [card(13), card(2, 'hearts')],
];

const countOf = (build: (hand: readonly Card[]) => HoldemVisibleState, type: HoldemAction['type']): number =>
  SAMPLE_HANDS.filter((hand) => action(build(hand))?.type === type).length;

function searchContext(seed: number, budgetMs: number): SearchContext {
  const began = performance.now();
  const timeLeftMs = (): number => Math.max(0, budgetMs - (performance.now() - began));
  return { random: seededRandom(seed), budget: { maxDepth: undefined, timeLeftMs, expired: () => timeLeftMs() === 0 } };
}

describe("Hold'em bot strategy", () => {
  it('estimates equity from random opponents and boards', () => {
    const random = seededRandom(5);
    expect(holdemEquity([card(14), card(14, 'hearts')], [], 1, random, 400)).toBeGreaterThan(0.75);
    expect(holdemEquity([card(7, 'hearts'), card(2)], [], 3, random, 400)).toBeLessThan(0.2);
    const board = [card(12), card(11), card(10), card(2, 'hearts'), card(3, 'clubs')];
    expect(holdemEquity([card(14), card(13)], board, 3, random, 50)).toBe(1);
  });

  it('runs in the worker pool and lets a human who times out only check or fold', () => {
    expect(GAME_BOTS.holdem.search?.strategy.exportName).toBe('holdemSearch');
    expect(GAME_BOTS.holdem.search?.budgetMs).toBeLessThanOrEqual(1500);
    const strategy = (): ReturnType<typeof getHoldemBotAction> => ({ type: 'holdem-action', action: { type: 'call' } });
    expect(GAME_BOTS.holdem.turnTimeout?.(visible({ myHand: [card(14), card(14, 'hearts')] }), { isBot: false, strategy }))
      .toEqual({ type: 'holdem-action', action: { type: 'fold' } });
  });

  it('acts only on its own turn while playing', () => {
    expect(getHoldemBotAction(visible({ currentTurnSeat: 'E' }), seededRandom(1))).toBeNull();
    expect(getHoldemBotAction(visible({ phase: 'scoring' }), seededRandom(1))).toBeNull();
  });

  describe('preflop with deep stacks', () => {
    it('folds trash, opens premium hands small, and checks its option for free', () => {
      expect(action(visible())).toEqual({ type: 'fold' });
      expect(action(visible({ myHand: [card(14), card(14, 'hearts')] }))).toEqual({ type: 'raise', to: 50 });
      const option = visible(gameSeatValues({ mySeat: 'E', currentTurnSeat: 'E', streetBets: { N: 20, E: 20, S: 20, W: 20 },
        acted: ['S', 'W', 'N'], log: [handEntry(1), actionEntry('S', 'call', 20), actionEntry('W', 'call', 20), actionEntry('N', 'call', 20)] }));
      expect(action(option)).toEqual({ type: 'check' });
    });

    it('opens wider with fewer seats left to act', () => {
      const first = countOf((hand) => visible({ myHand: hand }), 'raise');
      const button = countOf((hand) => visible(gameSeatValues({
        myHand: hand, mySeat: 'W', currentTurnSeat: 'W', folded: ['S'], acted: ['S'], log: [handEntry(1), actionEntry('S', 'fold', 0)],
      })), 'raise');
      expect(button).toBeGreaterThan(first);
    });
  });

  describe('short stacks', () => {
    /** Every seat holds `stack` chips at `bigBlind`; S acts first in. */
    const short = (hand: readonly Card[], stack: number, overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState => visible(gameSeatValues({
      myHand: hand, chips: { N: stack - 10, E: stack - 20, S: stack, W: stack }, ...overrides,
    }));

    it('pushes or folds from the chart', () => {
      expect(action(short([card(10), card(10, 'hearts')], 150))).toEqual({ type: 'raise', to: 150 });
      expect(action(short([card(7), card(2, 'hearts')], 150))).toEqual({ type: 'fold' });
      // Less than a minimum raise still goes all-in.
      expect(action(short([card(14), card(14, 'hearts')], 30))).toEqual({ type: 'raise', to: 30 });
    });

    it('pushes wider when trailing on the last hand and tighter when leading', () => {
      /** Last hand at 60/120 with S holding `mine` chips and the other seats `rival`. */
      const lastHand = (mine: number, rival: number) => (hand: readonly Card[]): HoldemVisibleState => visible(gameSeatValues({
        myHand: hand, hand: 20, smallBlind: 60, bigBlind: 120, currentBet: 120, minRaise: 120, log: [handEntry(20, 120)],
        chips: { N: rival - 60, E: rival - 120, S: mine, W: rival }, streetBets: { N: 60, E: 120, S: 0, W: 0 }, totalBets: { N: 60, E: 120, S: 0, W: 0 },
      }));
      // The effective stack is 1,500 chips in every case.
      const trailing = countOf(lastHand(1500, 2000), 'raise');
      const level = countOf(lastHand(1500, 1500), 'raise');
      const leading = countOf(lastHand(2000, 1500), 'raise');
      expect(trailing).toBeGreaterThan(level);
      expect(level).toBeGreaterThan(leading);
    });

    /** S moved all-in for `stack` chips first in; `seat` acts next with the given seats folded before it. */
    const facingShove = (seat: GameSeat, hand: readonly Card[], stack: number, folded: GameSeat[], earlier: HoldemLogEntry[] = []): HoldemVisibleState =>
      visible(gameSeatValues({
        mySeat: seat, currentTurnSeat: seat, myHand: hand, currentBet: stack, minRaise: stack - 20, acted: ['S', ...folded], folded,
        chips: { N: 990, E: 980, S: 0, W: 1000 }, streetBets: { N: 10, E: 20, S: stack, W: 0 }, totalBets: { N: 10, E: 20, S: stack, W: 0 },
        log: [...earlier, handEntry(earlier.length > 0 ? 9 : 1), actionEntry('S', 'raise', stack, true), ...folded.map((other) => actionEntry(other, 'fold', 0))],
        hand: earlier.length > 0 ? 9 : 1,
      }));

    it('calls a first-in all-in from the call chart, widest from the big blind', () => {
      expect(action(facingShove('W', [card(14), card(14, 'hearts')], 200, []))).toEqual({ type: 'call' });
      expect(action(facingShove('E', [card(7), card(2, 'hearts')], 200, ['W', 'N']))).toEqual({ type: 'fold' });
      const nextSeat = countOf((hand) => facingShove('W', hand, 200, []), 'call');
      const bigBlind = countOf((hand) => facingShove('E', hand, 200, ['W', 'N']), 'call');
      expect(bigBlind).toBeGreaterThan(nextSeat);
      expect(countOf((hand) => facingShove('E', hand, 1000, ['W', 'N']), 'call')).toBeLessThan(bigBlind);
    });

    it('reads an all-in the same way however often that seat shoved before', () => {
      const earlier: HoldemLogEntry[] = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((hand) => [
        handEntry(hand), actionEntry('S', 'raise', 1000, true), actionEntry('W', 'fold', 0), actionEntry('N', 'fold', 10), actionEntry('E', 'fold', 20),
      ]);
      for (const hand of SAMPLE_HANDS.slice(0, 12)) {
        expect(action(facingShove('E', hand, 1000, ['W', 'N'], earlier))).toEqual(action(facingShove('E', hand, 1000, ['W', 'N'])));
      }
    });
  });

  describe('after the flop', () => {
    /** Heads-up flop on K-7-2 rainbow after S raised and E called; S acts first into a pot of 120. */
    const flop = (hand: readonly Card[], overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState => visible(gameSeatValues({
      myHand: hand, street: 'flop', board: [card(13, 'hearts'), card(7, 'diamonds'), card(2, 'clubs')], folded: ['W', 'N'],
      currentBet: 0, minRaise: 20, streetBets: seats(0), acted: [], chips: { N: 990, E: 940, S: 940, W: 1000 },
      totalBets: { N: 10, E: 60, S: 60, W: 0 },
      log: [handEntry(1), actionEntry('S', 'raise', 60), actionEntry('W', 'fold', 0), actionEntry('N', 'fold', 10), actionEntry('E', 'call', 60),
        streetEntry('flop', [card(13, 'hearts'), card(7, 'diamonds'), card(2, 'clubs')])],
      ...overrides,
    }));
    const betSize = (state: HoldemVisibleState): number => {
      const sizes = SEEDS.map((seed) => action(state, seededRandom(seed))).map((chosen) => (chosen?.type === 'raise' ? chosen.to : 0));
      return sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
    };

    it('bets more with stronger hands', () => {
      const set = betSize(flop([card(13), card(13, 'diamonds')]));
      const middlePair = betSize(flop([card(7), card(6)]));
      expect(set).toBeGreaterThan(0);
      expect(set).toBeGreaterThan(middlePair);
    });

    /** S checked, E bet `bet` chips into the pot of 125. */
    const facing = (hand: readonly Card[], bet: number): HoldemVisibleState => {
      const base = flop(hand);
      return visible({
        ...base, currentBet: bet, minRaise: bet, acted: ['E'] as Seat[],
        streetBets: { ...base.streetBets, E: bet }, totalBets: { ...base.totalBets, E: 60 + bet }, chips: { ...base.chips, E: 940 - bet },
        log: [...base.log, actionEntry('S', 'check', 0), actionEntry('E', 'bet', bet)],
      });
    };

    it('calls a small bet with a middle pair and folds it to an overbet', () => {
      const middlePair = [card(7), card(6, 'hearts')];
      expect(shareOf(facing(middlePair, 30), 'fold')).toBe(0);
      expect(shareOf(facing(middlePair, 400), 'fold')).toBe(1);
      expect(action(facing([card(3), card(4, 'hearts')], 120))).toEqual({ type: 'fold' });
    });

    it('reads a larger bet as a stronger range', () => {
      const strength = (bet: number): number => {
        const state = facing([card(7), card(6, 'hearts')], bet);
        const [model] = opponentModels(buildContext(state, heLegalActions(state, 'S')!, seededRandom(1), FAST_EFFORT));
        let weighted = 0;
        model.range.weights.forEach((weight, index) => { weighted += weight * model.strength[index]; });
        return weighted / model.range.total;
      };
      expect(strength(200)).toBeGreaterThan(strength(30));
    });

    it('enumerates the river in the worker pool', () => {
      const river = flop([card(13), card(12)], gameSeatValues({ street: 'river', board: [card(13, 'hearts'), card(7, 'diamonds'), card(2, 'clubs'), card(9), card(4, 'hearts')] }));
      const first = holdemSearch(river, searchContext(1, 1000));
      expect(first?.type).toBe('holdem-action');
    });
  });

  describe('raising wars', () => {
    const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
    const CODE = 'HEBOT1';
    const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
      id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
    }])) as Record<Seat, PlayerInfo>;
    const key = (value: Card): string => `${value.suit}${value.rank}`;

    /** Fisher-Yates draws that put `top` first, in order. */
    function shuffleDraws(top: readonly Card[]): number[] {
      const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
      const target = [...top, ...rest];
      const deck = createDeck();
      const draws: number[] = [];
      for (let i = deck.length - 1; i > 0; i--) {
        const j = deck.findIndex((value) => key(value) === key(target[i]));
        draws.push((j + 0.5) / (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      return draws;
    }

    /** Preflop raises when every seat holds a strong hand, dealt by the rules from the button's left. */
    function preflopRaises(holes: Record<Seat, readonly [Card, Card]>, button: Seat): number {
      const order = [1, 2, 3, 4].map((step) => SEATS[(SEATS.indexOf(button) + step) % 4]);
      const top = [0, 1].flatMap((round) => order.map((seat) => holes[seat][round]));
      const rest = createDeck().filter((value) => !top.some((wanted) => key(wanted) === key(value)));
      const draws = [(SEATS.indexOf(button) + 0.5) / 4, ...shuffleDraws([...top, ...rest.slice(0, 5)])];
      let drawn = 0;
      holdem.restoreGames([]);
      holdem.startGame(CODE, PLAYERS, () => draws[drawn++] ?? 0.5, 0);
      const bot = seededRandom(11);
      while (holdem.getGameState(CODE)?.street === 'preflop' && holdem.getGameState(CODE)?.hand === 1) {
        const state = holdem.getGameState(CODE)!;
        const seat = state.currentTurnSeat;
        const decided = getHoldemBotAction(holdem.getPlayerVisibleState(CODE, seat)!, bot);
        if (decided?.type !== 'holdem-action') throw new Error('Expected a Hold\'em action');
        expect(holdem.act(CODE, seat, decided.action, 0, () => 0.5)).toEqual({ success: true });
      }
      const raises = holdem.getGameState(CODE)!.log.filter((entry) => entry.type === 'action' && entry.action === 'raise').length;
      holdem.restoreGames([]);
      return raises;
    }

    beforeEach(() => holdem.restoreGames([]));

    it('keeps preflop raises bounded when every seat holds a premium hand', () => {
      const premium: readonly (readonly [Card, Card])[] = [
        [card(14), card(14, 'hearts')], [card(13), card(13, 'hearts')], [card(12), card(12, 'hearts')], [card(14, 'clubs'), card(13, 'clubs')],
      ];
      const counts: number[] = [];
      for (const button of SEATS) {
        for (let turn = 0; turn < premium.length; turn++) {
          const holes = Object.fromEntries(SEATS.map((seat, index) => [seat, premium[(index + turn) % premium.length]])) as Record<Seat, readonly [Card, Card]>;
          counts.push(preflopRaises(holes, button));
        }
      }
      expect(Math.max(...counts)).toBeLessThanOrEqual(4);
    });
  });

  describe('re-raise limits', () => {
    const openedAndThreeBet = [
      handEntry(1), actionEntry('S', 'fold', 0), actionEntry('W', 'fold', 0), actionEntry('N', 'raise', 60), actionEntry('E', 'raise', 180),
    ];
    const aces = [card(14), card(14, 'hearts')];
    const afterThreeBet = (log: readonly HoldemLogEntry[], stakes: { N: number; E: number }): HoldemVisibleState => visible(gameSeatValues({
      mySeat: 'N', currentTurnSeat: 'N', myHand: aces, folded: ['S', 'W'], acted: ['E'], currentBet: stakes.E, minRaise: stakes.E - stakes.N,
      streetBets: { N: stakes.N, E: stakes.E, S: 0, W: 0 }, totalBets: { N: stakes.N, E: stakes.E, S: 0, W: 0 },
      chips: { N: 1000 - stakes.N, E: 1000 - stakes.E, S: 1000, W: 1000 }, log: [...log],
    }));

    it('raises premium hands once more after a three-bet', () => {
      expect(action(afterThreeBet(openedAndThreeBet, { N: 60, E: 180 }))?.type).toBe('raise');
    });

    it('only calls once the seat has made two preflop raises', () => {
      const fiveBet = [...openedAndThreeBet, actionEntry('N', 'raise', 420), actionEntry('E', 'raise', 700)];
      expect(action(afterThreeBet(fiveBet, { N: 420, E: 700 }))).toEqual({ type: 'call' });
    });
  });

  describe('whole matches', () => {
    function playersOf(count: number): Partial<Record<GameSeat, PlayerInfo>> {
      return Object.fromEntries(GAME_SEAT_ORDER.slice(0, count).map((seat) => [seat, {
        id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
      }]));
    }

    afterEach(() => {
      holdem.restoreGames([]);
      vi.restoreAllMocks();
    });

    it.each([2, 4, 6])('plays legally without mutating the view (%i players, search every few turns)', (count) => {
      const code = `HESR${count}`;
      holdem.startGame(code, playersOf(count), seededRandom(count * 7), 0);
      const random = seededRandom(count);
      runSeededGame(`holdem/${count}`, 3000, () => holdem.getGameState(code)?.phase === 'scoring', (step) => {
        const seat = holdem.getGameState(code)!.currentTurnSeat;
        const view = holdem.getPlayerVisibleState(code, seat)!;
        const before = structuredClone(view);
        const decided = step % 4 === 0 ? holdemSearch(view, searchContext(step, 40)) : getHoldemBotAction(view, random);
        expect(view).toEqual(before);
        if (decided?.type !== 'holdem-action') throw new Error('Expected a Hold\'em action');
        const legal = heLegalActions(view, seat)!;
        if (decided.action.type === 'check') expect(legal.check).toBe(true);
        if (decided.action.type === 'raise') {
          expect(decided.action.to).toBeGreaterThanOrEqual(legal.raise!.min);
          expect(decided.action.to).toBeLessThanOrEqual(legal.raise!.max);
        }
        expect(holdem.act(code, seat, decided.action, 0, random)).toEqual({ success: true });
      });
      expect(holdem.getGameState(code)?.result).not.toBeNull();
    });
  });
});
