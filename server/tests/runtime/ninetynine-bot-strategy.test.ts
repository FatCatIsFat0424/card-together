import { describe, expect, it } from 'vitest';
import type { Card, NinetyNineLogEntry, NinetyNineVisibleState, Seat } from '@shared/types';
import { getNinetyNineBotAction } from '../../src/bots/ninetynine-strategy';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });
const samples = [0, 0.25, 0.5, 0.75, 0.9999];

function state(myHand: Card[], overrides: Partial<NinetyNineVisibleState> = {}): NinetyNineVisibleState {
  return {
    gameType: 'ninetynine', phase: 'playing', mySeat: 'N', myHand,
    handCounts: { N: myHand.length, E: 5, S: 5, W: 5 }, total: 0, direction: 'ccw',
    currentTurnSeat: 'N', lastPlayed: null, stockCount: 20, eliminated: [],
    log: [], result: null, ...overrides,
  };
}

function play(seat: Seat, played: Card, total: number): NinetyNineLogEntry {
  return { type: 'play', seat, card: played, choice: null, target: null, total, timestamp: 0 };
}

function decisions(visible: NinetyNineVisibleState): ReturnType<typeof getNinetyNineBotAction>[] {
  return samples.map((sample) => getNinetyNineBotAction(visible, () => sample));
}

describe('Ninety-Nine bot turn order', () => {
  it('designates the seat that delays its own next turn near 99', () => {
    // Counterclockwise from N is W, S, E; designating W leaves the most opponent turns before N acts again.
    const visible = state([card('clubs', 5), card('clubs', 9), card('diamonds', 9), card('clubs', 8), card('clubs', 7)],
      { total: 99 });
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'ninetynine-play', card: card('clubs', 5), target: 'W' });
    }
  });

  it('reverses away from an opponent who just showed a rescue-rich hand', () => {
    const log = [play('S', card('clubs', 9), 20), play('W', card('hearts', 13), 99), play('E', card('diamonds', 11), 99)];
    const visible = state([card('clubs', 4), card('clubs', 11), card('clubs', 9), card('diamonds', 9), card('clubs', 8)],
      { total: 99, log });
    for (const action of decisions(visible)) {
      expect(action).toEqual({ type: 'ninetynine-play', card: card('clubs', 4) });
    }
  });

  it('does not mutate the filtered view', () => {
    const visible = state([card('clubs', 5), card('clubs', 9)], { total: 95, eliminated: ['E'] });
    const original = structuredClone(visible);
    decisions(visible);
    expect(visible).toEqual(original);
  });
});

describe('Ninety-Nine bot card conservation', () => {
  function played(visible: NinetyNineVisibleState): Card[] {
    return decisions(visible).map((action) => {
      if (action?.type !== 'ninetynine-play') throw new Error('Expected play');
      return action.card;
    });
  }

  it('keeps K and J at a low total and spends a number card instead', () => {
    const visible = state([card('clubs', 13), card('clubs', 11), card('clubs', 2), card('clubs', 3), card('clubs', 6)],
      { total: 10 });
    for (const spent of played(visible)) expect([2, 3, 6]).toContain(spent.rank);
  });

  it('keeps the spade ace, Q and 10 while number cards are safe', () => {
    const low = state([card('spades', 14), card('hearts', 12), card('clubs', 7), card('clubs', 8), card('clubs', 9)],
      { total: 30 });
    for (const spent of played(low)) expect([7, 8, 9]).toContain(spent.rank);
    const middle = state([card('hearts', 12), card('diamonds', 10), card('clubs', 9), card('clubs', 8), card('clubs', 2)],
      { total: 60 });
    for (const spent of played(middle)) expect([2, 8, 9]).toContain(spent.rank);
  });

  it('uses small number cards near 99 and saves minus cards', () => {
    const visible = state([card('hearts', 12), card('diamonds', 10), card('clubs', 2), card('clubs', 3), card('clubs', 9)],
      { total: 95 });
    for (const spent of played(visible)) expect([2, 3]).toContain(spent.rank);
  });

  it('does not set 99 with K when it would leave only number cards', () => {
    const visible = state([card('clubs', 13), card('clubs', 9), card('diamonds', 9), card('clubs', 8), card('diamonds', 8)],
      { total: 85 });
    for (const spent of played(visible)) expect([8, 9]).toContain(spent.rank);
  });

  it('pushes to 99 only when public discards show rescue cards are scarce', () => {
    const hand = [card('clubs', 13), card('clubs', 11), card('clubs', 6), card('clubs', 7), card('clubs', 8)];
    const fresh = state(hand, { total: 60, stockCount: 32 });
    for (const spent of played(fresh)) expect([6, 7, 8]).toContain(spent.rank);

    const suits: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
    const rescues = [
      ...suits.map((suit) => card(suit, 4)), ...suits.map((suit) => card(suit, 5)), ...suits.map((suit) => card(suit, 12)),
      ...suits.slice(1).map((suit) => card(suit, 11)), ...suits.slice(1).map((suit) => card(suit, 13)),
      card('clubs', 10), card('diamonds', 10),
    ];
    const order: Seat[] = ['W', 'S', 'E', 'N'];
    const log = rescues.map((spent, index) => play(order[index % 4], spent, 99));
    // Twenty cards in hands and twenty public plays in the discard pile leave twelve in stock.
    const depleted = state(hand, { total: 60, stockCount: 12, log });
    for (const spent of played(depleted)) expect(spent).toEqual(card('clubs', 13));
  });
});
