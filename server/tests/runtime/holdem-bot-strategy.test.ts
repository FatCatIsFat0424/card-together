import { gameSeatValues } from '../helpers/game-seat-values';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, GameSeat, HoldemAction, HoldemLogEntry, HoldemVisibleState, PlayerInfo, Seat } from '@shared/types';
import { heLegalActions } from '@shared/rules/holdem';
import { createDeck } from '../../src/engine/deck';
import * as holdem from '../../src/managers/games/holdem-game';
import { getHoldemBotAction, holdemEquity } from '../../src/bots/holdem-strategy';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Plays back fixed values, then repeats the last one. */
function scripted(...values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

/** Preflop with N to act facing the big blind; W is the button, so E and S posted the blinds. */
function visible(overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState {
  return gameSeatValues({
    gameType: 'holdem', phase: 'playing', mySeat: 'N', seats: ['N', 'E', 'S', 'W'], myHand: [card(2), card(7, 'hearts')], hand: 1, button: 'W',
    smallBlind: 10, bigBlind: 20, chips: { N: 1000, E: 990, S: 980, W: 1000 },
    streetBets: { N: 0, E: 10, S: 20, W: 0 }, totalBets: { N: 0, E: 10, S: 20, W: 0 },
    dealt: ['N', 'E', 'S', 'W'], folded: ['W'], street: 'preflop', board: [], currentBet: 20, minRaise: 20, acted: ['W'],
    revealed: seats([]), eliminated: [], currentTurnSeat: 'N', log: [], result: null, ...overrides,
  });
}

function action(state: HoldemVisibleState, random: () => number): HoldemAction | null {
  const decided = getHoldemBotAction(state, random);
  return decided?.type === 'holdem-action' ? decided.action : null;
}

/** Share of calls over several seeds, which smooths the sampling noise of close decisions. */
function callShare(state: HoldemVisibleState): number {
  const seedsUsed = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return seedsUsed.filter((seed) => action(state, seeded(seed))?.type === 'call').length / seedsUsed.length;
}

const handEntry = (hand: number, button: GameSeat, smallBlind: number, bigBlind: number, blinds: Record<GameSeat, number>): HoldemLogEntry =>
  ({ type: 'hand', hand, button, smallBlind, bigBlind, blinds, timestamp: 0 });
const actionEntry = (seat: GameSeat, kind: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): HoldemLogEntry =>
  ({ type: 'action', seat, action: kind, to, allIn, timestamp: 0 });

describe("Hold'em bot strategy", () => {
  it('estimates equity from random opponents and boards', () => {
    const random = seeded(5);
    expect(holdemEquity([card(14), card(14, 'hearts')], [], 1, random, 400)).toBeGreaterThan(0.75);
    expect(holdemEquity([card(7, 'hearts'), card(2)], [], 3, random, 400)).toBeLessThan(0.2);
    const nuts = [card(14), card(13)];
    const board = [card(12), card(11), card(10), card(2, 'hearts'), card(3, 'clubs')];
    expect(holdemEquity(nuts, board, 3, random, 50)).toBe(1);
  });

  it('folds trash to a bet, raises premium hands, and checks for free', () => {
    expect(action(visible(), seeded(1))).toEqual({ type: 'fold' });
    expect(action(visible({ myHand: [card(14), card(14, 'hearts')] }), seeded(1))).toEqual({ type: 'raise', to: 60 });
    expect(action(visible(gameSeatValues({ mySeat: 'S', currentTurnSeat: 'S', streetBets: { N: 20, E: 20, S: 20, W: 0 },
      acted: ['W', 'N', 'E'] })), seeded(1))).toEqual({ type: 'check' });
  });

  it('opens wider with fewer players left to act', () => {
    const hand = [card(10, 'hearts'), card(9, 'hearts')];
    // Three seats still to act, including the button.
    expect(action(visible(gameSeatValues({ myHand: hand, folded: [], acted: [] })), seeded(1))).toEqual({ type: 'fold' });
    // With the button already folded only the blinds remain, so the same hand opens.
    expect(action(visible({ myHand: hand }), seeded(1))).toEqual({ type: 'raise', to: 60 });
  });

  it('shoves strong hands when short-stacked and acts only on its own turn', () => {
    expect(action(visible(gameSeatValues({ myHand: [card(10), card(10, 'hearts')], chips: { N: 150, E: 990, S: 980, W: 1000 } })),
      seeded(1))).toEqual({ type: 'raise', to: 150 });
    expect(getHoldemBotAction(visible({ currentTurnSeat: 'E' }), seeded(1))).toBeNull();
    expect(getHoldemBotAction(visible({ phase: 'scoring' }), seeded(1))).toBeNull();
  });

  it('bets made hands after the flop and folds weak ones to a large bet', () => {
    const flop = gameSeatValues({ street: 'flop' as const, board: [card(14, 'hearts'), card(14, 'clubs'), card(7, 'diamonds')],
      currentBet: 0, minRaise: 20, streetBets: seats(0), acted: [] as Seat[], totalBets: { N: 20, E: 20, S: 20, W: 0 } });
    const strong = action(visible({ ...flop, myHand: [card(14), card(13)] }), scripted(0.9, 0.5));
    expect(strong?.type).toBe('raise');
    const facing = gameSeatValues({ ...flop, currentBet: 200, streetBets: { N: 0, E: 200, S: 0, W: 0 }, totalBets: { N: 20, E: 220, S: 20, W: 0 } });
    expect(action(visible({ ...facing, myHand: [card(2), card(3, 'hearts')] }), seeded(2))).toEqual({ type: 'fold' });
  });

  describe('defending against raises', () => {
    /** W, the button, shoves its whole stack of `to` chips; N acts next with both blinds still to act. */
    const shoveBy = (to: number, hand: readonly Card[], log: readonly HoldemLogEntry[] = []): HoldemVisibleState =>
      visible(gameSeatValues({
        myHand: hand, folded: [], acted: ['W'], currentBet: to, minRaise: to - 20, streetBets: { N: 0, E: 10, S: 20, W: to },
        totalBets: { N: 0, E: 10, S: 20, W: to }, chips: { N: 1000, E: 990, S: 980, W: 0 }, hand: log.length > 0 ? 10 : 1,
        log: [...log, handEntry(log.length > 0 ? 10 : 1, 'W', 10, 20, { N: 0, E: 10, S: 20, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }),
          actionEntry('W', 'raise', to, true)],
      }));

    it('calls a shove at a good price with a hand that beats a typical shoving range', () => {
      expect(callShare(shoveBy(60, [card(14), card(12, 'hearts')]))).toBe(1);
      expect(callShare(shoveBy(60, [card(7), card(2, 'hearts')]))).toBe(0);
    });

    it('folds the same hand when the shove is expensive', () => {
      expect(callShare(shoveBy(1000, [card(13), card(9, 'hearts')]))).toBe(0);
    });

    it('calls a shove wider once the seat has shoved hand after hand', () => {
      const blinds = { N: 0, E: 10, S: 20, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
      const earlier: HoldemLogEntry[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((hand) => [
        handEntry(hand, 'W', 10, 20, blinds), actionEntry('W', 'raise', 1000, true), actionEntry('N', 'fold', 0),
        actionEntry('E', 'fold', 10), actionEntry('S', 'fold', 20),
      ]);
      const hand = [card(13), card(11, 'hearts')];
      expect(callShare(shoveBy(1000, hand))).toBeLessThan(0.4);
      expect(callShare(shoveBy(1000, hand, earlier))).toBeGreaterThan(0.6);
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
      const bot = seeded(11);
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
    const blinds = { N: 10, E: 20, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
    const openedAndThreeBet = [
      handEntry(1, 'W', 10, 20, blinds), actionEntry('S', 'fold', 0), actionEntry('W', 'fold', 0),
      actionEntry('N', 'raise', 60), actionEntry('E', 'raise', 180),
    ];
    const aces = [card(14), card(14, 'hearts')];
    const afterThreeBet = (log: readonly HoldemLogEntry[], stakes: { N: number; E: number }): HoldemVisibleState => visible(gameSeatValues({
      myHand: aces, hand: 1, folded: ['S', 'W'], acted: ['E'], currentBet: stakes.E, minRaise: stakes.E - stakes.N,
      streetBets: { N: stakes.N, E: stakes.E, S: 0, W: 0 }, totalBets: { N: stakes.N, E: stakes.E, S: 0, W: 0 },
      chips: { N: 1000 - stakes.N, E: 1000 - stakes.E, S: 1000, W: 1000 }, log: [...log],
    }));

    it('raises premium hands once more after a three-bet', () => {
      expect(action(afterThreeBet(openedAndThreeBet, { N: 60, E: 180 }), seeded(4))?.type).toBe('raise');
    });

    it('only calls once the seat has made two preflop raises', () => {
      const fiveBet = [...openedAndThreeBet, actionEntry('N', 'raise', 420), actionEntry('E', 'raise', 700)];
      expect(action(afterThreeBet(fiveBet, { N: 420, E: 700 }), seeded(4))).toEqual({ type: 'call' });
    });
  });

  describe('match awareness', () => {
    /** Last hand at 60/120 where N holds 1,000 chips and every other seat holds `rival`. */
    const lastHand = (hand: readonly Card[], rival: number): HoldemVisibleState => visible(gameSeatValues({
      myHand: hand, hand: 20, smallBlind: 60, bigBlind: 120, currentBet: 120, minRaise: 120,
      chips: { N: 1000, E: rival - 60, S: rival - 120, W: rival }, streetBets: { N: 0, E: 60, S: 120, W: 0 }, totalBets: { N: 0, E: 60, S: 120, W: 0 },
    }));
    const sixFiveSuited = [card(6, 'hearts'), card(5, 'hearts')];
    const tenNine = [card(10), card(9, 'hearts')];

    it('pushes marginal hands when trailing on the last hand', () => {
      expect(action(lastHand(sixFiveSuited, 1000), seeded(5))).toEqual({ type: 'fold' });
      expect(action(lastHand(sixFiveSuited, 2500), seeded(5))).toEqual({ type: 'raise', to: 1000 });
    });

    it('folds marginal hands when comfortably ahead on the last hand', () => {
      expect(action(lastHand(tenNine, 1000), seeded(5))).toEqual({ type: 'raise', to: 1000 });
      expect(action(lastHand(tenNine, 600), seeded(5))).toEqual({ type: 'fold' });
    });
  });

  describe('postflop mixing', () => {
    const quads = [card(14), card(14, 'hearts')];
    const turn = gameSeatValues({
      street: 'turn' as const, board: [card(14, 'diamonds'), card(14, 'clubs'), card(13, 'hearts'), card(7)], myHand: quads,
      folded: ['S', 'W'], currentBet: 0, minRaise: 20, streetBets: seats(0), acted: [] as Seat[], totalBets: { N: 100, E: 100, S: 0, W: 0 },
      chips: { N: 900, E: 900, S: 1000, W: 1000 },
    });

    it('slows down with a monster on a fixed share of draws and bets otherwise', () => {
      expect(action(visible(turn), () => 0.05)).toEqual({ type: 'check' });
      expect(action(visible(turn), () => 0.9)?.type).toBe('raise');
    });

    it('check-raises more often than it raises without having checked', () => {
      const facing = gameSeatValues({ ...turn, currentBet: 60, minRaise: 60, streetBets: { N: 0, E: 60, S: 0, W: 0 }, acted: ['E'] as Seat[],
        totalBets: { N: 100, E: 160, S: 0, W: 0 }, chips: { N: 900, E: 840, S: 1000, W: 1000 } });
      const blinds = { N: 10, E: 20, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
      const street: HoldemLogEntry = { type: 'street', street: 'turn', cards: [card(7)], timestamp: 0 };
      const afterCheck = [handEntry(1, 'W', 10, 20, blinds), street, actionEntry('N', 'check', 0), actionEntry('E', 'bet', 60)];
      const withoutCheck = [handEntry(1, 'W', 10, 20, blinds), street, actionEntry('E', 'bet', 60)];
      expect(action(visible({ ...facing, log: afterCheck }), () => 0.7)?.type).toBe('raise');
      expect(action(visible({ ...facing, log: withoutCheck }), () => 0.7)).toEqual({ type: 'call' });
      expect(action(visible({ ...facing, log: afterCheck }), () => 0.9)).toEqual({ type: 'call' });
    });

    it('draws the bet size independently of the hand', () => {
      const small = action(visible(turn), () => 0.9);
      const large = action(visible({ ...turn, myHand: [card(14, 'spades'), card(14, 'hearts')] }), () => 0.9);
      expect(small).toEqual(large);
      const sizes = [0.9, 0.99].map((value) => action(visible(turn), () => value));
      expect(sizes[0]).not.toEqual(sizes[1]);
    });
  });

  describe('legal action clamping', () => {
    it('shoves a short stack for less than the minimum raise', () => {
      const short = visible(gameSeatValues({ myHand: [card(14), card(14, 'hearts')], chips: { N: 30, E: 990, S: 980, W: 1000 } }));
      expect(action(short, seeded(6))).toEqual({ type: 'raise', to: 30 });
    });

    it('always returns an action the rules allow', () => {
      const random = seeded(99);
      const deck = createDeck();
      const flop = [card(9, 'hearts'), card(5, 'clubs'), card(2, 'diamonds')];
      for (let run = 0; run < 150; run++) {
        const shuffled = [...deck].sort(() => random() - 0.5);
        const hole = shuffled.slice(0, 2);
        const stack = [30, 90, 400, 1000][run % 4];
        const shapes: Partial<HoldemVisibleState>[] = [
          gameSeatValues({ chips: { N: stack, E: 990, S: 980, W: 1000 } }),
          gameSeatValues({ chips: { N: stack, E: 800, S: 980, W: 1000 }, currentBet: 200, minRaise: 180, streetBets: { N: 0, E: 200, S: 20, W: 0 },
            totalBets: { N: 0, E: 200, S: 20, W: 0 }, acted: ['E'] }),
          gameSeatValues({ street: 'flop', board: flop, currentBet: 0, minRaise: 20, streetBets: seats(0), acted: [], chips: { N: stack, E: 900, S: 900, W: 900 },
            totalBets: { N: 100, E: 100, S: 100, W: 0 } }),
          gameSeatValues({ street: 'flop', board: flop, currentBet: 150, minRaise: 150, streetBets: { N: 0, E: 150, S: 0, W: 0 }, acted: ['E'],
            chips: { N: stack, E: 750, S: 900, W: 900 }, totalBets: { N: 100, E: 250, S: 100, W: 0 } }),
        ];
        for (const shape of shapes) {
          const state = visible({ ...shape, myHand: hole });
          const legal = heLegalActions(state, 'N')!;
          const chosen = action(state, random);
          expect(chosen).not.toBeNull();
          if (chosen?.type === 'check') expect(legal.check).toBe(true);
          if (chosen?.type === 'call') expect(legal.call).toBeGreaterThan(0);
          if (chosen?.type === 'raise') {
            expect(legal.raise).not.toBeNull();
            expect(chosen.to).toBeGreaterThanOrEqual(legal.raise!.min);
            expect(chosen.to).toBeLessThanOrEqual(legal.raise!.max);
          }
        }
      }
    });
  });
});
