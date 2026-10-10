import { describe, expect, it } from 'vitest';
import type { Card, HoldemVisibleState, Seat } from '@shared/types';
import { chenScore, getHoldemBotAction, holdemEquity } from '../../src/bots/holdem-strategy';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Preflop with N to act facing the big blind; W is the button, so E and S posted the blinds. */
function visible(overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState {
  return {
    gameType: 'holdem', phase: 'playing', mySeat: 'N', myHand: [card(2), card(7, 'hearts')], hand: 1, button: 'W',
    smallBlind: 10, bigBlind: 20, chips: { N: 1000, E: 990, S: 980, W: 1000 },
    streetBets: { N: 0, E: 10, S: 20, W: 0 }, totalBets: { N: 0, E: 10, S: 20, W: 0 },
    dealt: ['N', 'E', 'S', 'W'], folded: ['W'], street: 'preflop', board: [], currentBet: 20, minRaise: 20, acted: ['W'],
    revealed: seats([]), eliminated: [], currentTurnSeat: 'N', log: [], result: null, ...overrides,
  };
}

describe("Hold'em bot strategy", () => {
  it('scores preflop hands with the Chen formula', () => {
    expect(chenScore([card(14), card(14, 'hearts')])).toBe(20);
    expect(chenScore([card(14), card(13)])).toBe(12);
    expect(chenScore([card(14), card(13, 'hearts')])).toBe(10);
    expect(chenScore([card(2), card(2, 'hearts')])).toBe(5);
    expect(chenScore([card(7, 'hearts'), card(2)])).toBe(-1);
    expect(chenScore([card(9), card(8)])).toBe(8);
  });

  it('estimates equity from random opponents and boards', () => {
    const random = seeded(5);
    expect(holdemEquity([card(14), card(14, 'hearts')], [], 1, random, 400)).toBeGreaterThan(0.75);
    expect(holdemEquity([card(7, 'hearts'), card(2)], [], 3, random, 400)).toBeLessThan(0.2);
    const nuts = [card(14), card(13)];
    const board = [card(12), card(11), card(10), card(2, 'hearts'), card(3, 'clubs')];
    expect(holdemEquity(nuts, board, 3, random, 50)).toBe(1);
  });

  it('folds trash to a bet, raises premium hands, and checks for free', () => {
    expect(getHoldemBotAction(visible(), seeded(1))).toEqual({ type: 'holdem-action', action: { type: 'fold' } });
    expect(getHoldemBotAction(visible({ myHand: [card(14), card(14, 'hearts')] }), seeded(1)))
      .toEqual({ type: 'holdem-action', action: { type: 'raise', to: 60 } });
    expect(getHoldemBotAction(visible({ mySeat: 'S', currentTurnSeat: 'S', streetBets: { N: 20, E: 20, S: 20, W: 0 },
      acted: ['W', 'N', 'E'] }), seeded(1))).toEqual({ type: 'holdem-action', action: { type: 'check' } });
  });

  it('shoves strong hands when short-stacked and acts only on its own turn', () => {
    expect(getHoldemBotAction(visible({ myHand: [card(10), card(10, 'hearts')], chips: { N: 150, E: 990, S: 980, W: 1000 } }),
      seeded(1))).toEqual({ type: 'holdem-action', action: { type: 'raise', to: 150 } });
    expect(getHoldemBotAction(visible({ currentTurnSeat: 'E' }), seeded(1))).toBeNull();
    expect(getHoldemBotAction(visible({ phase: 'scoring' }), seeded(1))).toBeNull();
  });

  it('bets made hands after the flop and folds weak ones to a large bet', () => {
    const flop = { street: 'flop' as const, board: [card(14, 'hearts'), card(14, 'clubs'), card(7, 'diamonds')],
      currentBet: 0, minRaise: 20, streetBets: seats(0), acted: [] as Seat[], totalBets: { N: 20, E: 20, S: 20, W: 0 } };
    const strong = getHoldemBotAction(visible({ ...flop, myHand: [card(14), card(13)] }), seeded(2));
    expect(strong?.type === 'holdem-action' && strong.action.type).toBe('raise');
    const facing = { ...flop, currentBet: 200, streetBets: { N: 0, E: 200, S: 0, W: 0 }, totalBets: { N: 20, E: 220, S: 20, W: 0 } };
    expect(getHoldemBotAction(visible({ ...facing, myHand: [card(2), card(3, 'hearts')] }), seeded(2)))
      .toEqual({ type: 'holdem-action', action: { type: 'fold' } });
  });
});
