import { describe, expect, it } from 'vitest';
import { GAME_SEAT_ORDER } from '@shared/constants';
import {
  TH_MULTIPLIERS, thApplyEntry, thCardHalves, thEmptyTable, thHalves, thHandKind, thIsMaxed, thMultiplier, thNextTurn,
  thOutcome, thPoints, thReplay, thSettle, thStrength,
} from '@shared/rules/tenhalf';
import type { ThTable } from '@shared/rules/tenhalf';
import type { Card, GameSeat, TenHalfLogEntry } from '@shared/types';

const card = (rank: Card['rank'], suit: Card['suit'] = 'spades'): Card => ({ suit, rank });
const cards = (...ranks: Card['rank'][]): Card[] => ranks.map((rank, index) => card(rank, (['spades', 'hearts', 'clubs', 'diamonds'] as const)[index % 4]));
const zero = Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0])) as Record<GameSeat, number>;

const TEN_HALF = cards(10, 13);
const TIANWANG = cards(2, 2, 3, 3, 13);
const FIVE_FACES = cards(11, 12, 13, 11, 12);
const FIVE_SMALL = cards(14, 14, 14, 14, 14);

/** A table for `seats` after `hand 1` was dealt with the given stakes; holes are passed to `thSettle`. */
function dealt(banker: GameSeat, bets: Partial<Record<GameSeat, number>>, seats: readonly GameSeat[]): ThTable {
  const table = thEmptyTable(seats);
  thApplyEntry(table, { type: 'deal', hand: 1, banker, bets: { ...zero, ...bets }, timestamp: 0 });
  return table;
}

describe('Ten and a Half values', () => {
  it('counts an ace as 1, 2-10 at face value, and J/Q/K as half a point', () => {
    expect([14, 2, 9, 10, 11, 12, 13].map((rank) => thPoints(thCardHalves(card(rank as Card['rank']))))).toEqual([1, 2, 9, 10, 0.5, 0.5, 0.5]);
    expect(thPoints(thHalves(cards(10, 13)))).toBe(10.5);
    expect(thPoints(thHalves(cards(14, 14, 13)))).toBe(2.5);
  });

  it('classifies busts, ordinary totals, and each special hand', () => {
    expect(thHandKind(cards(10, 12, 2))).toBe('bust');
    expect(thHandKind(cards(10, 9))).toBe('bust');
    expect(thHandKind(cards(5, 4))).toBe('points');
    expect(thHandKind(TEN_HALF)).toBe('tenhalf');
    expect(thHandKind(cards(5, 5, 13))).toBe('tenhalf');
    expect(thHandKind(FIVE_SMALL)).toBe('fivesmall');
    expect(thHandKind(TIANWANG)).toBe('tianwang');
    expect(thHandKind(FIVE_FACES)).toBe('renwuxiao');
    expect(thHandKind(cards(10, 10, 10, 10, 10))).toBe('bust');
  });

  it('pays 1, 2, 3, 4, and 5 times for ordinary, ten and a half, five small, Tianwang, and five faces', () => {
    expect([TEN_HALF, FIVE_SMALL, TIANWANG, FIVE_FACES, cards(5, 3)].map(thMultiplier)).toEqual([2, 3, 4, 5, 1]);
    expect(TH_MULTIPLIERS).toEqual({ bust: 1, points: 1, tenhalf: 2, fivesmall: 3, tianwang: 4, renwuxiao: 5 });
  });

  it('ranks every special hand above any total and a bust below everything', () => {
    const order = [FIVE_FACES, TIANWANG, FIVE_SMALL, TEN_HALF, cards(10)].map(thStrength);
    expect(order[0]).toBeGreaterThan(order[1]);
    expect(order[1]).toBeGreaterThan(order[2]);
    expect(order[2]).toBeGreaterThan(order[3]);
    expect(order[3]).toBeGreaterThan(order[4]);
    expect(thStrength(cards(10, 9))).toBe(-1);
    expect(thStrength(cards(14))).toBeGreaterThan(thStrength(cards(10, 9)));
  });

  it('stops drawing at 10.5, a bust, or the fifth card', () => {
    expect(thIsMaxed(cards(10))).toBe(false);
    expect(thIsMaxed(TEN_HALF)).toBe(true);
    expect(thIsMaxed(cards(10, 9))).toBe(true);
    expect(thIsMaxed(cards(14, 14, 14, 14))).toBe(false);
    expect(thIsMaxed(FIVE_SMALL)).toBe(true);
  });
});

describe('Ten and a Half outcomes', () => {
  it('gives ties to the banker', () => {
    expect(thOutcome(cards(7), cards(7))).toBe('lose');
    expect(thOutcome(cards(8), cards(7))).toBe('win');
    expect(thOutcome(TEN_HALF, cards(10, 13))).toBe('lose');
    expect(thOutcome(FIVE_FACES, FIVE_FACES)).toBe('lose');
  });

  it('lets a special hand beat a bigger ordinary total and a higher special hand beat a lower one', () => {
    expect(thOutcome(FIVE_SMALL, cards(10, 13))).toBe('win');
    expect(thOutcome(TEN_HALF, FIVE_SMALL)).toBe('lose');
    expect(thOutcome(TIANWANG, FIVE_SMALL)).toBe('win');
    expect(thOutcome(FIVE_FACES, TIANWANG)).toBe('win');
  });

  it('beats a banker bust unless the player busted first', () => {
    expect(thOutcome(cards(2), cards(10, 9))).toBe('win');
    expect(thOutcome(cards(10, 9), cards(10, 9))).toBe('bust');
  });
});

describe('Ten and a Half turn order', () => {
  it('asks unfinished players in seat order and then the banker', () => {
    const table = dealt('E', { N: 10, S: 10 }, ['N', 'E', 'S']);
    expect(thNextTurn(table)).toBe('N');
    table.done.N = true;
    expect(thNextTurn(table)).toBe('S');
    table.done.S = true;
    expect(thNextTurn(table)).toBe('E');
    table.done.E = true;
    expect(thNextTurn(table)).toBeNull();
  });
});

describe('Ten and a Half settlement', () => {
  const total = (chips: Record<GameSeat, number>): number => GAME_SEAT_ORDER.reduce((sum, seat) => sum + chips[seat], 0);

  it('pays a plain win one bet and takes a plain loss one bet, keeping the chips in play', () => {
    const table = dealt('N', { E: 100, S: 50 }, ['N', 'E', 'S']);
    const result = thSettle(table, { N: card(5), E: card(8), S: card(2) });
    expect(result.outcomes).toMatchObject({ N: null, E: 'win', S: 'lose' });
    expect(result.net).toMatchObject({ N: -50, E: 100, S: -50 });
    expect(total(result.chips)).toBe(3000);
  });

  it('multiplies a win by the winner’s own hand and a loss by the banker’s hand', () => {
    const table = dealt('N', { E: 100, S: 100 }, ['N', 'E', 'S']);
    table.ups.E = cards(13).slice(0, 1);
    table.ups.N = [];
    table.ups.S = [];
    const win = thSettle(table, { N: card(5), E: card(10), S: card(3) });
    // E holds 10 and K: ten and a half, ×2.
    expect(win.net.E).toBe(200);
    expect(win.net.S).toBe(-100);
    const bankerSpecial = dealt('N', { E: 100, S: 100 }, ['N', 'E', 'S']);
    bankerSpecial.ups.N = cards(13).slice(0, 1);
    const loss = thSettle(bankerSpecial, { N: card(10), E: card(9), S: card(5) });
    // The banker holds ten and a half, so both players pay twice their bet.
    expect(loss.net).toMatchObject({ E: -200, S: -200, N: 400 });
  });

  it('charges a busted player the banker’s multiple, or one bet when the banker busted too', () => {
    const table = dealt('N', { E: 100 }, ['N', 'E']);
    table.ups.E = cards(9).slice(0, 1);
    table.ups.N = [];
    expect(thSettle(table, { N: card(5), E: card(10) }).outcomes.E).toBe('bust');
    expect(thSettle(table, { N: card(5), E: card(10) }).net.E).toBe(-100);
    table.ups.N = cards(10);
    expect(thSettle(table, { N: card(10), E: card(10) }).net.E).toBe(-100);
  });

  it('never takes more than the chips a player held before the hand', () => {
    const table = thEmptyTable(['N', 'E']);
    table.chips.E = 150;
    thApplyEntry(table, { type: 'deal', hand: 1, banker: 'N', bets: { ...zero, E: 100 }, timestamp: 0 });
    table.ups.N = [card(13)];
    const result = thSettle(table, { N: card(10), E: card(5) });
    expect(result.chips.E).toBe(0);
    expect(result.net.E).toBe(-150);
    expect(result.chips.N).toBe(1150);
  });

  it('shares a short banker’s chips among winners in proportion to what each is owed', () => {
    const table = thEmptyTable(['N', 'E', 'S']);
    table.chips.N = 90;
    thApplyEntry(table, { type: 'deal', hand: 1, banker: 'N', bets: { ...zero, E: 100, S: 200 }, timestamp: 0 });
    const result = thSettle(table, { N: card(2), E: card(9), S: card(9) });
    // Owed 100 and 200 against 90 chips: 30 and 60.
    expect(result.net).toMatchObject({ E: 30, S: 60, N: -90 });
    expect(result.chips.N).toBe(0);
    expect(total(result.chips)).toBe(90 + 2000);
  });

  it('leaves seats that sat out untouched', () => {
    const table = dealt('N', { E: 20 }, ['N', 'E', 'S']);
    const result = thSettle(table, { N: card(5), E: card(8) });
    expect(result.outcomes.S).toBeNull();
    expect(result.net.S).toBe(0);
    expect(result.chips.S).toBe(1000);
  });
});

describe('Ten and a Half log replay', () => {
  it('rebuilds chips, face-up cards, finished seats, and revealed holes from the public log', () => {
    const log: TenHalfLogEntry[] = [
      { type: 'bet', seat: 'E', auto: false, timestamp: 1 },
      { type: 'deal', hand: 1, banker: 'N', bets: { ...zero, E: 40 }, timestamp: 2 },
      { type: 'hit', seat: 'E', card: card(3), done: false, timestamp: 3 },
      { type: 'stand', seat: 'E', timestamp: 4 },
      { type: 'stand', seat: 'N', timestamp: 5 },
      { type: 'showdown', hand: 1, holes: { ...Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, null])), N: card(5), E: card(9) } as Record<GameSeat, Card | null>, timestamp: 6 },
    ];
    const midHand = thReplay(log, ['N', 'E'], 3);
    expect(midHand.chips).toMatchObject({ N: 1000, E: 960 });
    expect(midHand.ups.E).toEqual([card(3)]);
    expect(midHand.holes.E).toBeNull();
    expect(midHand.done.E).toBe(false);
    const shown = thReplay(log, ['N', 'E'], log.length);
    expect(shown.done).toMatchObject({ E: true, N: true });
    expect(shown.holes).toMatchObject({ N: card(5), E: card(9) });
  });
});
