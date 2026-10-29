import { describe, expect, it } from 'vitest';
import type { Card, CardOrJoker, GameSeat } from '@shared/types';
import { cardKey, isJoker } from '@shared/rules/cards';
import {
  OM_DEALS, omApplyOrder, omDealHands, omDeck, omDiscardPairs, omIsPermutation, omNextHolder, omPlacePoints,
  omRandomOrder, omShuffle, omStarter, omWinners,
} from '@shared/rules/oldmaid';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('Old Maid rules', () => {
  it('should build 52 cards plus exactly one joker', () => {
    const deck = omDeck();
    expect(deck).toHaveLength(53);
    expect(deck.filter(isJoker)).toEqual([{ joker: 'big' }]);
    expect(new Set(deck.map(cardKey)).size).toBe(53);
  });

  it('should shuffle without losing or duplicating cards and leave the input alone', () => {
    const deck = omDeck();
    const before = deck.map(cardKey);
    const shuffled = omShuffle(deck, seeded(3));
    expect(deck.map(cardKey)).toEqual(before);
    expect([...shuffled.map(cardKey)].sort()).toEqual([...before].sort());
    expect(shuffled.map(cardKey)).not.toEqual(before);
    expect(omShuffle(deck, () => 0.999999).length).toBe(53);
  });

  it('should deal every card one at a time starting with the first seat', () => {
    const seats: GameSeat[] = ['N', 'E', 'S'];
    const hands = omDealHands(omDeck(), seats);
    expect(seats.map((seat) => hands.get(seat)?.length)).toEqual([18, 18, 17]);
    expect(hands.get('N')?.[1]).toEqual(omDeck()[3]);
  });

  describe('pair discard', () => {
    it('should remove pairs of equal rank and keep the rest in order', () => {
      const hand: CardOrJoker[] = [c('hearts', 5), c('clubs', 9), c('spades', 5), { joker: 'big' }, c('diamonds', 12)];
      const { kept, pairs } = omDiscardPairs(hand);
      expect(kept).toEqual([c('clubs', 9), { joker: 'big' }, c('diamonds', 12)]);
      expect(pairs).toEqual([c('hearts', 5), c('spades', 5)]);
    });

    it('should discard two pairs from four of a kind and one pair from three', () => {
      const four = omDiscardPairs([c('hearts', 7), c('clubs', 7), c('spades', 7), c('diamonds', 7)]);
      expect(four.kept).toEqual([]);
      expect(four.pairs).toHaveLength(4);
      const three = omDiscardPairs([c('hearts', 7), c('clubs', 7), c('spades', 7)]);
      expect(three.kept).toEqual([c('spades', 7)]);
      expect(three.pairs).toEqual([c('hearts', 7), c('clubs', 7)]);
    });

    it('should never pair the joker and leave a hand without pairs untouched', () => {
      const hand: CardOrJoker[] = [{ joker: 'big' }, c('clubs', 2), c('hearts', 3)];
      expect(omDiscardPairs(hand)).toEqual({ kept: hand, pairs: [] });
      expect(omDiscardPairs([])).toEqual({ kept: [], pairs: [] });
    });

    it('should leave a dealt deck holding the joker and at most one card per rank in every hand', () => {
      const seats: GameSeat[] = ['N', 'E', 'S', 'W'];
      const hands = omDealHands(omShuffle(omDeck(), seeded(8)), seats);
      let kept = 0;
      let discarded = 0;
      for (const seat of seats) {
        const result = omDiscardPairs(hands.get(seat) ?? []);
        const ranks = result.kept.filter((card): card is Card => !isJoker(card)).map((card) => card.rank);
        expect(new Set(ranks).size).toBe(ranks.length);
        kept += result.kept.length;
        discarded += result.pairs.length;
      }
      expect(kept + discarded).toBe(53);
      expect(discarded % 2).toBe(0);
    });
  });

  describe('seats and orders', () => {
    const seats: GameSeat[] = ['N', 'E', 'S', 'W'];

    it('should draw from the next seat that still holds cards', () => {
      const counts = { N: 3, E: 0, S: 2, W: 1, P5: 0, P6: 0, P7: 0, P8: 0 };
      expect(omNextHolder('N', seats, counts)).toBe('S');
      expect(omNextHolder('S', seats, counts)).toBe('W');
      expect(omNextHolder('W', seats, counts)).toBe('N');
      expect(omNextHolder('N', seats, { ...counts, S: 0, W: 0 })).toBeNull();
    });

    it('should accept only a permutation of the hand', () => {
      expect(omIsPermutation([2, 0, 1], 3)).toBe(true);
      expect(omIsPermutation([], 0)).toBe(true);
      expect(omIsPermutation([0, 0, 1], 3)).toBe(false);
      expect(omIsPermutation([0, 1], 3)).toBe(false);
      expect(omIsPermutation([0, 1, 3], 3)).toBe(false);
      expect(omIsPermutation([0, 1, -1], 3)).toBe(false);
      expect(omIsPermutation([0, 1, 1.5], 3)).toBe(false);
    });

    it('should apply an order and generate random permutations', () => {
      expect(omApplyOrder(['a', 'b', 'c'], [2, 0, 1])).toEqual(['c', 'a', 'b']);
      for (let seed = 1; seed < 20; seed++) expect(omIsPermutation(omRandomOrder(9, seeded(seed)), 9)).toBe(true);
    });

    it('should rotate the first drawer through the seats each deal', () => {
      expect([1, 2, 3, 4].map((deal) => omStarter(deal, seats))).toEqual(['N', 'E', 'S', 'W']);
      expect(omStarter(5, seats)).toBe('N');
    });
  });

  describe('scoring', () => {
    it('should score placement points with the joker holder last on zero', () => {
      expect([1, 2, 3, 4].map((place) => omPlacePoints(4, place))).toEqual([3, 2, 1, 0]);
      expect([1, 2].map((place) => omPlacePoints(2, place))).toEqual([1, 0]);
    });

    it('should name every seat with the most points as a winner', () => {
      const totals = { N: 3, E: 5, S: 5, W: 1, P5: 0, P6: 0, P7: 0, P8: 0 };
      expect(omWinners(totals, ['N', 'E', 'S', 'W'])).toEqual(['E', 'S']);
      expect(omWinners(totals, ['N', 'W'])).toEqual(['N']);
    });

    it('should play a fixed number of deals', () => {
      expect(OM_DEALS).toBe(3);
    });
  });
});
