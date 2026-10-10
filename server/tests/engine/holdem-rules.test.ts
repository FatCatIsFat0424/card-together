import { describe, expect, it } from 'vitest';
import type { Card, HoldemLogEntry, Seat } from '@shared/types';
import {
  HE_HANDS, heApplyEntry, heAward, heBestHand, heBlinds, heBlindSeats, heEliminations, heEmptyTable, heFirstToAct,
  heLegalActions, heMatchOver, heNextButton, heNextToAct, hePots, heWinners,
} from '@shared/rules/holdem';
import type { HeTable } from '@shared/rules/holdem';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });

function hand(button: Seat, blinds: Partial<Record<Seat, number>>, number = 1): HoldemLogEntry {
  const { smallBlind, bigBlind } = heBlinds(number);
  return { type: 'hand', hand: number, button, smallBlind, bigBlind, blinds: { ...seats(0), ...blinds }, timestamp: 1 };
}

function act(seat: Seat, action: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): HoldemLogEntry {
  return { type: 'action', seat, action, to, allIn, timestamp: 1 };
}

function applyOne(state: HeTable, entry: HoldemLogEntry): HeTable {
  heApplyEntry(state, entry);
  return state;
}

/** The public table after `log`, starting from custom chip counts. */
function table(log: HoldemLogEntry[], chips: Record<Seat, number> = seats(1000)): HeTable {
  const state = heEmptyTable();
  state.chips = { ...chips };
  for (const entry of log) heApplyEntry(state, entry);
  return state;
}

describe("Hold'em hand evaluation", () => {
  it('picks the best five of seven cards', () => {
    expect(heBestHand([card(14), card(13, 'hearts'), card(12, 'hearts'), card(11, 'clubs'), card(10), card(2, 'diamonds'), card(3, 'clubs')]))
      .toMatchObject({ category: 'straight', ranks: [14] });
    expect(heBestHand([card(9), card(9, 'hearts'), card(9, 'clubs'), card(4), card(4, 'hearts'), card(4, 'clubs'), card(2)]))
      .toMatchObject({ category: 'fullHouse', ranks: [9, 4] });
    expect(heBestHand([card(14), card(2, 'hearts'), card(3), card(4, 'clubs'), card(5), card(13), card(13, 'hearts')]))
      .toMatchObject({ category: 'straight', ranks: [5] });
    expect(heBestHand([card(2), card(7), card(9), card(11), card(13), card(3, 'hearts'), card(4, 'hearts')]))
      .toMatchObject({ category: 'flush', ranks: [13, 11, 9, 7, 2] });
  });
});

describe("Hold'em positions and blinds", () => {
  it('raises blinds every four hands and caps at the last level', () => {
    expect(heBlinds(1)).toEqual({ smallBlind: 10, bigBlind: 20 });
    expect(heBlinds(5)).toEqual({ smallBlind: 15, bigBlind: 30 });
    expect(heBlinds(17)).toEqual({ smallBlind: 60, bigBlind: 120 });
    expect(heBlinds(HE_HANDS)).toEqual({ smallBlind: 60, bigBlind: 120 });
  });

  it('posts blinds after the button, with the button on the small blind heads-up', () => {
    expect(heBlindSeats(['N', 'E', 'S', 'W'], 'W')).toEqual({ small: 'N', big: 'E' });
    expect(heBlindSeats(['N', 'S', 'W'], 'N')).toEqual({ small: 'S', big: 'W' });
    expect(heBlindSeats(['E', 'W'], 'W')).toEqual({ small: 'W', big: 'E' });
    expect(heNextButton('E', { N: 100, E: 50, S: 0, W: 10 })).toBe('W');
  });

  it('opens preflop after the big blind and gives the big blind its option', () => {
    let state = table([hand('N', { E: 10, S: 20 })]);
    expect(heFirstToAct(state)).toBe('W');
    for (const seat of ['W', 'N', 'E'] as const) {
      state = applyOne(state, act(seat, 'call', 20));
    }
    expect(heNextToAct(state, 'E')).toBe('S');
    expect(heLegalActions(state, 'S')).toMatchObject({ check: true, call: 0, raise: { min: 40, max: 1000 } });
    state = applyOne(state, act('S', 'check', 20));
    expect(heNextToAct(state, 'S')).toBeNull();
  });

  it('acts first on later streets from the seat after the button, and heads-up from the big blind', () => {
    const state = table([hand('N', { E: 10, S: 20 }), act('W', 'call', 20), act('N', 'call', 20), act('E', 'call', 20),
      act('S', 'check', 20), { type: 'street', street: 'flop', cards: [card(2), card(3), card(4)], timestamp: 1 }]);
    expect(heFirstToAct(state)).toBe('E');
    const headsUp = table([hand('W', { W: 10, E: 20 })], { N: 0, E: 500, S: 0, W: 500 });
    expect(heFirstToAct(headsUp)).toBe('W');
    const flop = applyOne(applyOne(applyOne(headsUp, act('W', 'call', 20)), act('E', 'check', 20)),
      { type: 'street', street: 'flop', cards: [card(2), card(3), card(4)], timestamp: 1 });
    expect(heFirstToAct(flop)).toBe('E');
  });
});

describe("Hold'em betting", () => {
  it('requires a full raise and lets a full raise reopen betting', () => {
    let state = table([hand('N', { E: 10, S: 20 })]);
    expect(heLegalActions(state, 'W')).toMatchObject({ check: false, call: 20, raise: { min: 40, max: 1000 } });
    state = applyOne(state, act('W', 'raise', 60));
    expect(state).toMatchObject({ currentBet: 60, minRaise: 40, acted: ['W'] });
    expect(heLegalActions(state, 'N')?.raise).toEqual({ min: 100, max: 1000 });
  });

  it('does not let earlier actors re-raise a short all-in raise', () => {
    const chips = { N: 1000, E: 1000, S: 1000, W: 1000 };
    let state = table([hand('N', { E: 10, S: 20 })], chips);
    state = applyOne(state, act('W', 'raise', 100));
    state.chips.N = 30;
    state = applyOne(state, act('N', 'call', 100));
    state.chips.E = 140;
    state = applyOne(state, act('E', 'raise', 150, true));
    expect(state).toMatchObject({ currentBet: 150, minRaise: 80 });
    expect(heNextToAct(state, 'E')).toBe('S');
    state = applyOne(state, act('S', 'call', 150));
    expect(heNextToAct(state, 'S')).toBe('W');
    expect(heLegalActions(state, 'W')).toMatchObject({ call: 50, raise: null });
  });

  it('offers only an all-in raise when the stack is below a full raise, and none against all-in opponents', () => {
    let state = table([hand('N', { E: 10, S: 20 })], { N: 80, E: 1000, S: 1000, W: 1000 });
    state = applyOne(state, act('W', 'raise', 60));
    expect(heLegalActions(state, 'N')?.raise).toEqual({ min: 80, max: 80 });
    state.chips.N = 50;
    expect(heLegalActions(state, 'N')).toMatchObject({ call: 50, raise: null });
    const allIn = table([hand('W', { W: 10, E: 20 })], { N: 0, E: 20, S: 0, W: 500 });
    expect(heLegalActions(allIn, 'W')).toMatchObject({ call: 10, raise: null });
  });
});

describe("Hold'em pots and awards", () => {
  it('builds side pots from contribution levels and returns uncalled chips', () => {
    const state = heEmptyTable();
    state.dealt = ['N', 'E', 'S', 'W'];
    state.folded = ['W'];
    state.totalBets = { N: 100, E: 300, S: 500, W: 50 };
    expect(hePots(state)).toEqual([
      { amount: 350, eligible: ['N', 'E', 'S'] },
      { amount: 400, eligible: ['E', 'S'] },
      { amount: 200, eligible: ['S'] },
    ]);
  });

  it('awards each pot to its best hand, splitting with odd chips clockwise from the button', () => {
    const state = heEmptyTable();
    state.button = 'N';
    state.dealt = ['N', 'E', 'S', 'W'];
    state.folded = ['N'];
    state.chips = seats(0);
    state.totalBets = { N: 5, E: 100, S: 100, W: 40 };
    state.board = [card(2, 'hearts'), card(7, 'clubs'), card(9, 'diamonds'), card(12, 'clubs'), card(13, 'hearts')];
    state.revealed = { N: [], E: [card(14), card(3)], S: [card(14, 'clubs'), card(3, 'hearts')], W: [card(13), card(13, 'clubs')] };
    const award = heAward(state);
    expect(award.pots).toEqual([
      { amount: 125, eligible: ['E', 'S', 'W'], winners: ['W'] },
      { amount: 120, eligible: ['E', 'S'], winners: ['E', 'S'] },
    ]);
    expect(award.payouts).toEqual({ N: 0, E: 60, S: 60, W: 125 });
    state.totalBets = { N: 0, E: 51, S: 51, W: 0 };
    state.revealed.W = [];
    state.dealt = ['N', 'E', 'S'];
    expect(heAward(state).payouts).toEqual({ N: 0, E: 51, S: 51, W: 0 });
    state.totalBets = { N: 1, E: 51, S: 51, W: 0 };
    expect(heAward(state).payouts).toEqual({ N: 0, E: 52, S: 51, W: 0 });
  });

  it('orders eliminations by starting stack and ends the match with one holder or after the last hand', () => {
    const state = heEmptyTable();
    state.dealt = ['N', 'E', 'S'];
    state.totalBets = { N: 300, E: 100, S: 900, W: 0 };
    expect(heEliminations(state, { N: 0, E: 0, S: 1300, W: 2700 })).toEqual(['E', 'N']);
    state.chips = { N: 0, E: 0, S: 0, W: 4000 };
    expect(heMatchOver(state)).toBe(true);
    state.chips = { N: 1000, E: 1000, S: 1000, W: 1000 };
    state.hand = HE_HANDS - 1;
    expect(heMatchOver(state)).toBe(false);
    state.hand = HE_HANDS;
    expect(heMatchOver(state)).toBe(true);
    expect(heWinners({ N: 1500, E: 1500, S: 1000, W: 0 })).toEqual(['N', 'E']);
  });
});
