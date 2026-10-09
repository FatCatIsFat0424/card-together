import { describe, it, expect } from 'vitest';
import type { Card, Rank, SevensTable, Suit } from '@shared/types';
import {
  SV_HAND_SIZE,
  svApply,
  svCardPenalty,
  svEmptyTable,
  svIsPlayable,
  svLegalPlays,
  svOrder,
  svPenalty,
  svSortHand,
  svTableCards,
  svWinners,
} from '@shared/rules/sevens';

const SUITS: Record<string, Suit> = { C: 'clubs', D: 'diamonds', H: 'hearts', S: 'spades' };
const RANKS: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** 'AH' → A♥, '10S' → 10♠ */
function c(code: string): Card {
  return { rank: RANKS[code.slice(0, -1)], suit: SUITS[code.slice(-1)] };
}

function place(table: SevensTable, ...codes: string[]): SevensTable {
  return codes.reduce((current, code) => svApply(current, c(code)), table);
}

describe('sevens rules', () => {
  it('exposes the hand size and ace-low ordering', () => {
    expect(SV_HAND_SIZE).toBe(13);
    expect(svOrder(c('AS'))).toBe(1);
    expect(svOrder(c('2S'))).toBe(2);
    expect(svOrder(c('KS'))).toBe(13);
  });

  it('allows only the spade seven on the first play', () => {
    const table = svEmptyTable();
    expect(svIsPlayable(table, c('7S'), true)).toBe(true);
    expect(svIsPlayable(table, c('7H'), true)).toBe(false);
    expect(svIsPlayable(table, c('8S'), true)).toBe(false);
    expect(svLegalPlays([c('7H'), c('7S'), c('3C')], table, true)).toEqual([c('7S')]);
  });

  it('lets any seven open its suit once the game has started', () => {
    const table = place(svEmptyTable(), '7S');
    expect(svIsPlayable(table, c('7H'), false)).toBe(true);
    expect(svApply(table, c('7H')).hearts).toEqual({ low: 7, high: 7 });
    expect(svIsPlayable(table, c('6H'), false)).toBe(false);
    expect(svIsPlayable(table, c('8H'), false)).toBe(false);
  });

  it('extends both ends of an open row by exactly one', () => {
    const table = place(svEmptyTable(), '7S', '8S', '6S');
    expect(table.spades).toEqual({ low: 6, high: 8 });
    expect(svIsPlayable(table, c('5S'), false)).toBe(true);
    expect(svIsPlayable(table, c('9S'), false)).toBe(true);
    expect(svIsPlayable(table, c('4S'), false)).toBe(false);
    expect(svIsPlayable(table, c('10S'), false)).toBe(false);
    expect(svIsPlayable(table, c('7S'), false)).toBe(false);
  });

  it('plays the ace at the low end and the king at the high end without wrapping', () => {
    let table = place(svEmptyTable(), '7S', '6S', '5S', '4S', '3S', '2S');
    expect(svIsPlayable(table, c('AS'), false)).toBe(true);
    table = svApply(table, c('AS'));
    expect(table.spades).toEqual({ low: 1, high: 7 });
    // The ace is not also a high card after the king
    expect(svIsPlayable(table, c('KS'), false)).toBe(false);
    table = place(table, '8S', '9S', '10S', 'JS', 'QS');
    expect(svIsPlayable(table, c('KS'), false)).toBe(true);
    table = svApply(table, c('KS'));
    expect(table.spades).toEqual({ low: 1, high: 13 });
    expect(svLegalPlays([c('AH'), c('KH')], table, false)).toEqual([]);
  });

  it('keeps suits independent and preserves hand order in legal plays', () => {
    const table = place(svEmptyTable(), '7S', '8S', '7D');
    const hand = [c('9S'), c('3C'), c('6D'), c('KD'), c('7C'), c('9H')];
    expect(svLegalPlays(hand, table, false)).toEqual([c('9S'), c('6D'), c('7C')]);
  });

  it('throws when applying a card that does not fit', () => {
    expect(() => svApply(svEmptyTable(), c('6S'))).toThrow();
    expect(() => svApply(place(svEmptyTable(), '7S'), c('9S'))).toThrow();
  });

  it('does not mutate the table or the hand', () => {
    const table = place(svEmptyTable(), '7S', '8S');
    const tableCopy = structuredClone(table);
    const hand = [c('9S'), c('AH')];
    const handCopy = structuredClone(hand);
    const next = svApply(table, c('9S'));
    svLegalPlays(hand, table, false);
    svSortHand(hand);
    svTableCards(table);
    expect(table).toEqual(tableCopy);
    expect(hand).toEqual(handCopy);
    expect(next).not.toBe(table);
    expect(next.spades).toEqual({ low: 7, high: 9 });
  });

  it('sums penalties with ace as 1 and face cards as 11-13', () => {
    expect(svCardPenalty(c('AS'))).toBe(1);
    expect(svCardPenalty(c('10H'))).toBe(10);
    expect(svCardPenalty(c('JH'))).toBe(11);
    expect(svCardPenalty(c('QH'))).toBe(12);
    expect(svCardPenalty(c('KH'))).toBe(13);
    expect(svPenalty([])).toBe(0);
    expect(svPenalty([c('AS'), c('2C'), c('KD')])).toBe(16);
  });

  it('picks the lowest penalties as winners, ties included, in N, E, S, W order', () => {
    expect(svWinners({ N: 10, E: 3, S: 7, W: 12 })).toEqual(['E']);
    expect(svWinners({ N: 5, E: 9, S: 5, W: 5 })).toEqual(['N', 'S', 'W']);
    expect(svWinners({ N: 0, E: 0, S: 0, W: 0 })).toEqual(['N', 'E', 'S', 'W']);
  });

  it('lists every card represented by the table', () => {
    expect(svTableCards(svEmptyTable())).toEqual([]);
    const table = place(svEmptyTable(), '7S', '6S', '7H', '8H');
    expect(svTableCards(table)).toEqual([c('6S'), c('7S'), c('7H'), c('8H')]);
    const full = place(svEmptyTable(), '7C', '6C', '5C', '4C', '3C', '2C', 'AC');
    expect(svTableCards(full)).toEqual(
      ['AC', '2C', '3C', '4C', '5C', '6C', '7C'].map(c),
    );
  });

  it('sorts hands by suit then ace-low order', () => {
    const sorted = svSortHand([c('KD'), c('AS'), c('7H'), c('2S'), c('AH')]);
    expect(sorted).toEqual([c('AS'), c('2S'), c('AH'), c('7H'), c('KD')]);
  });
});
