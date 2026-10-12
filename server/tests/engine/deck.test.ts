import { describe, it, expect } from 'vitest';
import { createDeck, shuffleDeck } from '../../src/engine/deck';

describe('deck engine', () => {

  describe('createDeck', () => {
    it('should contain exactly one of every suit and rank', () => {
      const expected = ['spades', 'hearts', 'clubs', 'diamonds'].flatMap((suit) =>
        Array.from({ length: 13 }, (_, index) => `${suit}-${index + 2}`));
      expect(createDeck().map((card) => `${card.suit}-${card.rank}`).sort()).toEqual(expected.sort());
    });
  });

  describe('shuffleDeck', () => {
    it('should preserve every card and the caller input with an injected random source', () => {
      const deck = createDeck();
      const before = structuredClone(deck);
      const shuffled = shuffleDeck(deck, () => 0.25);
      expect(shuffled).not.toBe(deck);
      expect(deck).toEqual(before);
      expect(shuffled.map((card) => `${card.suit}-${card.rank}`).sort())
        .toEqual(before.map((card) => `${card.suit}-${card.rank}`).sort());
    });

    it('should produce different order with different random seed', () => {
      const deck = createDeck();
      let seed = 42;
      const seededRandom = (): number => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const shuffled1 = shuffleDeck(deck, seededRandom);

      seed = 99;
      const shuffled2 = shuffleDeck(deck, seededRandom);

      const same = shuffled1.every(
        (c, i) => c.suit === shuffled2[i].suit && c.rank === shuffled2[i].rank,
      );
      expect(same).toBe(false);
    });

    it('should produce deterministic output with same seed', () => {
      const deck = createDeck();
      const createSeeded = (): (() => number) => {
        let s = 42;
        return (): number => {
          s = (s * 16807) % 2147483647;
          return (s - 1) / 2147483646;
        };
      };

      const shuffled1 = shuffleDeck(deck, createSeeded());
      const shuffled2 = shuffleDeck(deck, createSeeded());

      expect(shuffled1).toEqual(shuffled2);
    });
  });
});
