import { describe, expect, it } from 'vitest';
import {
  cardKey, createJokerDeck, hasCard, isCardOrJoker, isJoker, joker, removeCards, sameCard, withJokers,
} from '@shared/rules/cards';
import { createNapoleonDeck, napoleonCardKey, napoleonJoker } from '@shared/rules/napoleon';
import type { CardOrJoker } from '@shared/types';
import { createDeck, createJokerDeck as createServerJokerDeck } from '../../src/engine/deck';

const jokersOf = (deck: readonly CardOrJoker[]): string[] => deck.filter(isJoker).map(cardKey);

describe('shared joker cards', () => {
  it('keys suit cards and jokers with the persisted ids', () => {
    expect(cardKey({ suit: 'spades', rank: 14 })).toBe('S14');
    expect(cardKey({ suit: 'hearts', rank: 2 })).toBe('H2');
    expect(cardKey(joker('big'))).toBe('BJ');
    expect(cardKey(joker('small'))).toBe('SJ');
    expect(joker('big')).toEqual({ joker: 'big' });
  });

  it('keys every card of a full deck uniquely and compares by key', () => {
    const deck = createJokerDeck(2);
    expect(new Set(deck.map(cardKey)).size).toBe(54);
    expect(sameCard(joker('small'), { joker: 'small' })).toBe(true);
    expect(sameCard(joker('small'), joker('big'))).toBe(false);
    expect(hasCard(deck, joker('big'))).toBe(true);
    expect(removeCards(deck, [joker('big'), { suit: 'clubs', rank: 2 }])).toHaveLength(52);
  });

  it('accepts only exact card and joker payloads', () => {
    expect(isCardOrJoker({ suit: 'clubs', rank: 2 })).toBe(true);
    expect(isCardOrJoker({ joker: 'big' })).toBe(true);
    expect(isCardOrJoker({ joker: 'small' })).toBe(true);
    for (const bad of [
      null, 'BJ', [], {}, { joker: 'medium' }, { joker: 'big', suit: 'clubs' }, { suit: 'clubs' },
      { suit: 'clubs', rank: 15 }, { suit: 'stars', rank: 2 }, { suit: 'clubs', rank: 2, extra: 1 },
    ]) expect(isCardOrJoker(bad), JSON.stringify(bad)).toBe(false);
  });

  it('builds a deck with zero, one or two jokers', () => {
    expect(createJokerDeck(0)).toHaveLength(52);
    expect(jokersOf(createJokerDeck(0))).toEqual([]);
    expect(createJokerDeck(1)).toHaveLength(53);
    expect(jokersOf(createJokerDeck(1))).toEqual(['BJ']);
    expect(createJokerDeck(2)).toHaveLength(54);
    expect(jokersOf(createJokerDeck(2))).toEqual(['BJ', 'SJ']);
  });

  it('appends jokers after the given cards without changing them', () => {
    const base = createDeck();
    expect(withJokers(base, 0)).toEqual(base);
    expect(withJokers(base, 2).slice(0, 52)).toEqual(base);
    expect(base).toHaveLength(52);
  });

  it('keeps createDeck unchanged and builds the server joker deck on it', () => {
    expect(createDeck()).toHaveLength(52);
    expect(createServerJokerDeck(2).slice(0, 52)).toEqual(createDeck());
    expect(jokersOf(createServerJokerDeck(1))).toEqual(['BJ']);
  });

  it('keeps Napoleon on the shared model', () => {
    expect(createNapoleonDeck()).toEqual(createJokerDeck(2));
    expect(napoleonJoker('small')).toEqual({ joker: 'small' });
    expect(napoleonCardKey(joker('big'))).toBe('BJ');
  });
});
