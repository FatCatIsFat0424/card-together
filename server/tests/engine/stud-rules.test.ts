import { describe, expect, it } from 'vitest';
import type { Card, GameSeat, StudLogEntry } from '@shared/types';
import { GAME_SEAT_ORDER } from '@shared/constants';
import {
  STUD_HANDS, STUD_STARTING_CHIPS, studApplyEntry, studAward, studCompareShowing, studEmptyTable, studFirstToAct,
  studHand, studReplay, studShowingOrder, studStakes,
} from '@shared/rules/stud';
import type { StudTable } from '@shared/rules/stud';
import { heEliminations, heLegalActions, heNextToAct } from '@shared/rules/holdem';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const empty = (): Record<GameSeat, Card[]> => Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, []])) as unknown as Record<GameSeat, Card[]>;
const zero = (): Record<GameSeat, number> => Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0])) as Record<GameSeat, number>;

function hand(button: GameSeat, antes: Partial<Record<GameSeat, number>>, number = 1): StudLogEntry {
  const { ante, minBet } = studStakes(number);
  return { type: 'hand', hand: number, button, ante, minBet, antes: { ...zero(), ...antes }, timestamp: 1 };
}

function street(value: 2 | 3 | 4 | 5, cards: Partial<Record<GameSeat, Card>>): StudLogEntry {
  const dealt = empty();
  for (const [seat, dealtCard] of Object.entries(cards)) dealt[seat as GameSeat] = [dealtCard];
  return { type: 'street', street: value, cards: dealt, timestamp: 1 };
}

function act(seat: GameSeat, action: 'fold' | 'check' | 'call' | 'bet' | 'raise', to: number, allIn = false): StudLogEntry {
  return { type: 'action', seat, action, to, allIn, timestamp: 1 };
}

function table(log: StudLogEntry[], seats: readonly GameSeat[] = ['N', 'E', 'S']): StudTable {
  return studReplay(log, seats);
}

describe('stud stakes', () => {
  it('uses the Hold\'em schedule for antes and minimum bets', () => {
    expect([1, 4, 5, 9, 13, 17, 20].map((n) => Object.values(studStakes(n)))).toEqual([
      [10, 20], [10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [60, 120]]);
    expect(STUD_HANDS).toBe(20);
    expect(STUD_STARTING_CHIPS).toBe(1000);
  });
});

describe('stud showing-card comparison', () => {
  it('ranks single cards by rank and breaks ties by suit, spades highest', () => {
    expect(studCompareShowing([card(14, 'clubs')], [card(13, 'spades')])).toBeGreaterThan(0);
    expect(studCompareShowing([card(9, 'spades')], [card(9, 'hearts')])).toBeGreaterThan(0);
    expect(studCompareShowing([card(9, 'hearts')], [card(9, 'diamonds')])).toBeGreaterThan(0);
    expect(studCompareShowing([card(9, 'diamonds')], [card(9, 'clubs')])).toBeGreaterThan(0);
  });

  it('ranks pairs above high cards and groups by multiplicity', () => {
    expect(studCompareShowing([card(4), card(4, 'hearts')], [card(14), card(13)])).toBeGreaterThan(0);
    expect(studCompareShowing([card(5), card(5, 'hearts'), card(5, 'clubs')], [card(14), card(14, 'hearts'), card(13)]))
      .toBeGreaterThan(0);
    expect(studCompareShowing([card(8), card(8, 'hearts'), card(3), card(3, 'hearts')], [card(8, 'clubs'), card(8, 'diamonds'), card(14), card(2)]))
      .toBeGreaterThan(0);
    // Higher pair wins, then the kicker, and straights or flushes are not recognised
    expect(studCompareShowing([card(9), card(9, 'hearts'), card(2)], [card(8), card(8, 'hearts'), card(14)])).toBeGreaterThan(0);
    expect(studCompareShowing([card(9), card(9, 'hearts'), card(3)], [card(9, 'clubs'), card(9, 'diamonds'), card(2)])).toBeGreaterThan(0);
    expect(studCompareShowing([card(2), card(3), card(4), card(5)], [card(2, 'hearts'), card(3, 'hearts'), card(4, 'hearts'), card(6, 'hearts')]))
      .toBeLessThan(0);
  });

  it('breaks identical rank patterns by the suit of the pair', () => {
    expect(studCompareShowing([card(9, 'spades'), card(9, 'clubs')], [card(9, 'hearts'), card(9, 'diamonds')])).toBeGreaterThan(0);
  });

  it('orders unfolded seats strongest first and skips folded ones', () => {
    const state = table([
      hand('N', { N: 10, E: 10, S: 10 }),
      street(2, { N: card(7), E: card(12, 'clubs'), S: card(12, 'hearts') }),
      act('S', 'fold', 0),
    ]);
    expect(studShowingOrder(state)).toEqual(['E', 'N']);
  });
});

describe('stud action order', () => {
  it('lets the best up card open every street and then goes clockwise', () => {
    const state = table([
      hand('N', { N: 10, E: 10, S: 10 }),
      street(2, { N: card(7), E: card(12, 'clubs'), S: card(12, 'hearts') }),
    ]);
    expect(studFirstToAct(state)).toBe('S');
    studApplyEntry(state, act('S', 'check', 0));
    expect(heNextToAct(state, 'S')).toBe('N');
    studApplyEntry(state, act('N', 'check', 0));
    studApplyEntry(state, act('E', 'check', 0));
    expect(heNextToAct(state, 'E')).toBeNull();
    studApplyEntry(state, street(3, { N: card(7, 'hearts'), E: card(12, 'diamonds'), S: card(2) }));
    // E now shows a pair of queens
    expect(studFirstToAct(state)).toBe('E');
  });

  it('skips an all-in best hand when finding who acts', () => {
    const state = table([
      hand('N', { N: 10, E: 10, S: 10 }),
      street(2, { N: card(14), E: card(5), S: card(6) }),
    ]);
    state.chips.N = 0;
    expect(studFirstToAct(state)).toBe('E');
  });

  it('returns null when only one seat can still act against all-in seats', () => {
    const state = table([
      hand('N', { N: 10, E: 10, S: 10 }),
      street(2, { N: card(14), E: card(5), S: card(6) }),
    ]);
    state.chips.N = 0;
    state.chips.E = 0;
    expect(studFirstToAct(state)).toBeNull();
  });

  it('opens with a check or a bet of at least the minimum, never a fixed bring-in', () => {
    const state = table([hand('N', { N: 10, E: 10, S: 10 }), street(2, { N: card(7), E: card(8), S: card(9) })]);
    expect(heLegalActions(state, 'S')).toMatchObject({ check: true, call: 0, raise: { min: 20, max: 990 } });
  });
});

describe('stud antes, pots, and showdown', () => {
  it('posts antes as dead money and starts streets with no stake', () => {
    const state = table([hand('N', { N: 10, E: 10, S: 5 }), street(2, { N: card(7), E: card(8), S: card(9) })]);
    expect(state.chips).toMatchObject({ N: 990, E: 990, S: 995 });
    expect(state.totalBets).toMatchObject({ N: 10, E: 10, S: 5 });
    expect(state.streetBets).toMatchObject({ N: 0, E: 0, S: 0 });
    expect(state).toMatchObject({ currentBet: 0, minRaise: 20, street: 2, dealt: ['N', 'E', 'S'] });
  });

  it('awards the best five cards and splits side pots by contribution', () => {
    const state = studEmptyTable(['N', 'E', 'S']);
    state.dealt = ['N', 'E', 'S'];
    state.totalBets = { ...zero(), N: 60, E: 110, S: 110 };
    state.up.N = [card(14), card(14, 'hearts'), card(2), card(3)];
    state.up.E = [card(13), card(9, 'hearts'), card(8, 'clubs'), card(4)];
    state.up.S = [card(12), card(12, 'hearts'), card(12, 'clubs'), card(5)];
    state.revealed = { ...empty(), N: [card(10, 'clubs')], E: [card(2, 'hearts')], S: [card(7, 'diamonds')] };
    const { pots, payouts } = studAward(state);
    // Aces against king high against three queens: S takes the 180 main pot and the 100 side pot.
    expect(pots).toEqual([
      { amount: 180, eligible: ['N', 'E', 'S'], winners: ['S'] },
      { amount: 100, eligible: ['E', 'S'], winners: ['S'] },
    ]);
    expect(payouts.S).toBe(280);
  });

  it('breaks showdown ties by chop, with odd chips clockwise from the button', () => {
    const state = table([hand('N', { N: 10, E: 10, S: 10 }), street(2, { N: card(7), E: card(8), S: card(9) })]);
    state.folded = ['S'];
    state.totalBets.S = 11;
    state.up.N = [card(14), card(13), card(12), card(11)];
    state.up.E = [card(14, 'hearts'), card(13, 'hearts'), card(12, 'hearts'), card(11, 'hearts')];
    state.revealed = { ...empty(), N: [card(2)], E: [card(2, 'hearts')] };
    state.button = 'N';
    const { payouts } = studAward(state);
    // 10 + 10 + 11 = 31: each gets 15 and the odd chip goes to E, the first winner clockwise after the button
    expect(payouts).toMatchObject({ N: 15, E: 16 });
  });

  it('evaluates a five-card hand from hole plus up cards, suits never breaking ties', () => {
    expect(studHand([card(10)], [card(11, 'hearts'), card(12, 'hearts'), card(13, 'hearts'), card(14, 'hearts')]))
      .toMatchObject({ category: 'straight' });
    expect(studHand([card(2)], [card(2, 'hearts'), card(2, 'clubs'), card(9), card(9, 'hearts')]))
      .toMatchObject({ category: 'fullHouse' });
  });

  it('eliminates seats that end a hand without chips', () => {
    const state = table([hand('N', { N: 10, E: 10, S: 10 })]);
    expect(heEliminations(state, { ...zero(), N: 0, E: 20, S: 10 })).toEqual(['N']);
  });

  it('replays the award as the new chip counts', () => {
    const log: StudLogEntry[] = [
      hand('N', { N: 10, E: 10 }),
      street(2, { N: card(7), E: card(8) }),
      act('E', 'fold', 0),
      { type: 'award', pots: [{ amount: 20, eligible: ['N'], winners: ['N'] }], chips: { ...zero(), N: 1010, E: 990 }, eliminated: [], timestamp: 1 },
    ];
    const state = studReplay(log, ['N', 'E']);
    expect(state.chips).toMatchObject({ N: 1010, E: 990 });
    expect(state.totalBets).toMatchObject({ N: 0, E: 0 });
    expect(studEmptyTable(['N', 'E']).chips).toMatchObject({ N: 1000, E: 1000, S: 0 });
  });
});
