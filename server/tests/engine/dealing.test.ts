import { describe, it, expect } from 'vitest';
import { createDeck } from '../../src/engine/deck';
import { dealCards, sortHand, calculateHandPoints, isRedealEligible, findRedealEligibleSeat } from '../../src/engine/dealing';
import type { Card, Seat } from '@shared/types';

describe('dealing engine', () => {

  describe('dealCards', () => {
    it('should deal every card clockwise without changing the deck', () => {
      const deck = createDeck();
      const before = structuredClone(deck);
      const hands = dealCards(deck);
      const seats: Seat[] = ['N', 'E', 'S', 'W'];
      for (const [index, seat] of seats.entries()) {
        expect(hands[seat]).toEqual(before.filter((_card, position) => position % 4 === index));
      }
      expect(deck).toEqual(before);
      expect(Object.values(hands).flat().map((card) => `${card.suit}-${card.rank}`).sort())
        .toEqual(before.map((card) => `${card.suit}-${card.rank}`).sort());
    });
  });

  describe('sortHand', () => {
    it('should sort by suit order: spades > hearts > clubs > diamonds', () => {
      const hand: Card[] = [
        { suit: 'diamonds', rank: 14 },
        { suit: 'spades', rank: 2 },
        { suit: 'hearts', rank: 14 },
        { suit: 'clubs', rank: 14 },
      ];
      const sorted = sortHand(hand);
      expect(sorted[0].suit).toBe('spades');
      expect(sorted[1].suit).toBe('hearts');
      expect(sorted[2].suit).toBe('clubs');
      expect(sorted[3].suit).toBe('diamonds');
    });

    it('should sort same suit by rank descending (A > K > Q > ...)', () => {
      const hand: Card[] = [
        { suit: 'spades', rank: 2 },
        { suit: 'spades', rank: 14 },
        { suit: 'spades', rank: 11 },
        { suit: 'spades', rank: 13 },
      ];
      const sorted = sortHand(hand);
      expect(sorted.map((c) => c.rank)).toEqual([14, 13, 11, 2]);
    });
  });

  describe('calculateHandPoints', () => {
    it('should return 0 for hand with no face cards', () => {
      // All ranks 2-10
      const lowHand: Card[] = [
        { suit: 'spades', rank: 2 }, { suit: 'spades', rank: 3 },
        { suit: 'spades', rank: 4 }, { suit: 'spades', rank: 5 },
        { suit: 'hearts', rank: 2 }, { suit: 'hearts', rank: 3 },
        { suit: 'hearts', rank: 4 }, { suit: 'hearts', rank: 5 },
        { suit: 'clubs', rank: 2 }, { suit: 'clubs', rank: 3 },
        { suit: 'diamonds', rank: 2 }, { suit: 'diamonds', rank: 3 },
        { suit: 'diamonds', rank: 4 },
      ];
      expect(calculateHandPoints(lowHand)).toBe(0);
    });

    it('should calculate A=4, K=3, Q=2, J=1', () => {
      const hand: Card[] = [
        { suit: 'spades', rank: 14 },  // A = 4
        { suit: 'spades', rank: 13 },  // K = 3
        { suit: 'spades', rank: 12 },  // Q = 2
        { suit: 'spades', rank: 11 },  // J = 1
        { suit: 'hearts', rank: 2 },
        { suit: 'hearts', rank: 3 },
        { suit: 'hearts', rank: 4 },
        { suit: 'hearts', rank: 5 },
        { suit: 'clubs', rank: 2 },
        { suit: 'clubs', rank: 3 },
        { suit: 'diamonds', rank: 2 },
        { suit: 'diamonds', rank: 3 },
        { suit: 'diamonds', rank: 4 },
      ];
      expect(calculateHandPoints(hand)).toBe(10);
    });
  });

  describe('isRedealEligible', () => {
    it.each([
      { name: 'four points without an ace', honors: [13, 11], eligible: true },
      { name: 'five points without an ace', honors: [13, 12], eligible: false },
      { name: 'four points with an ace', honors: [14], eligible: true },
      { name: 'five points with an ace', honors: [14, 11], eligible: false },
      { name: 'zero points without an ace', honors: [], eligible: true },
    ])('checks $name', ({ honors, eligible }) => {
      const low: Card[] = [
        ...Array.from({ length: 9 }, (_, index) => ({ suit: 'spades', rank: index + 2 } as Card)),
        ...[2, 3, 4, 5].map((rank) => ({ suit: 'hearts', rank }) as Card),
      ];
      const hand = low.map((card, index) => index < honors.length ? { ...card, rank: honors[index] } as Card : card);
      expect(isRedealEligible(hand)).toBe(eligible);
    });
  });

  describe('findRedealEligibleSeat', () => {
    it('should return the first eligible seat in clockwise order', () => {
      const hands: Record<Seat, Card[]> = {
        N: [
          { suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 },
          { suit: 'spades', rank: 12 }, { suit: 'spades', rank: 11 },
          { suit: 'hearts', rank: 14 }, { suit: 'hearts', rank: 13 },
          { suit: 'hearts', rank: 12 }, { suit: 'hearts', rank: 11 },
          { suit: 'clubs', rank: 14 }, { suit: 'clubs', rank: 13 },
          { suit: 'diamonds', rank: 14 }, { suit: 'diamonds', rank: 13 },
          { suit: 'diamonds', rank: 12 },
        ],
        E: [
          { suit: 'spades', rank: 2 }, { suit: 'spades', rank: 3 },
          { suit: 'spades', rank: 4 }, { suit: 'spades', rank: 5 },
          { suit: 'hearts', rank: 2 }, { suit: 'hearts', rank: 3 },
          { suit: 'hearts', rank: 4 }, { suit: 'hearts', rank: 5 },
          { suit: 'clubs', rank: 2 }, { suit: 'clubs', rank: 3 },
          { suit: 'diamonds', rank: 2 }, { suit: 'diamonds', rank: 3 },
          { suit: 'diamonds', rank: 4 },
        ],
        S: [
          { suit: 'spades', rank: 6 }, { suit: 'spades', rank: 7 },
          { suit: 'spades', rank: 8 }, { suit: 'spades', rank: 9 },
          { suit: 'hearts', rank: 6 }, { suit: 'hearts', rank: 7 },
          { suit: 'hearts', rank: 8 }, { suit: 'hearts', rank: 9 },
          { suit: 'clubs', rank: 4 }, { suit: 'clubs', rank: 5 },
          { suit: 'diamonds', rank: 5 }, { suit: 'diamonds', rank: 6 },
          { suit: 'diamonds', rank: 7 },
        ],
        W: [
          { suit: 'spades', rank: 10 },
          { suit: 'hearts', rank: 10 },
          { suit: 'clubs', rank: 6 }, { suit: 'clubs', rank: 7 },
          { suit: 'clubs', rank: 8 }, { suit: 'clubs', rank: 9 },
          { suit: 'clubs', rank: 10 }, { suit: 'clubs', rank: 11 },
          { suit: 'clubs', rank: 12 },
          { suit: 'diamonds', rank: 8 }, { suit: 'diamonds', rank: 9 },
          { suit: 'diamonds', rank: 10 }, { suit: 'diamonds', rank: 11 },
        ],
      };
      // N: has aces, E: 0 HCP no aces (eligible), S: 0 HCP no aces (eligible), W: has J (1 HCP, eligible)
      expect(findRedealEligibleSeat(hands, 'N')).toBe('E');
    });

    it('should return null when nobody is eligible', () => {
      const goodHand: Card[] = [
        { suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 },
        { suit: 'spades', rank: 12 }, { suit: 'spades', rank: 11 },
        { suit: 'hearts', rank: 14 }, { suit: 'hearts', rank: 13 },
        { suit: 'hearts', rank: 12 }, { suit: 'hearts', rank: 11 },
        { suit: 'clubs', rank: 14 }, { suit: 'clubs', rank: 13 },
        { suit: 'diamonds', rank: 14 }, { suit: 'diamonds', rank: 13 },
        { suit: 'diamonds', rank: 12 },
      ];
      const hands: Record<Seat, Card[]> = {
        N: goodHand, E: goodHand, S: goodHand, W: goodHand,
      };
      expect(findRedealEligibleSeat(hands, 'N')).toBeNull();
    });
  });
});
