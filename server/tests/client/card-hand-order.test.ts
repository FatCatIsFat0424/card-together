import { describe, expect, it } from 'vitest';
import type { Card } from '@shared/types';
import { moveHandCard, reconcileHandOrder } from '../../../client/src/components/card-hand-order';

const cards: readonly Card[] = Object.freeze([
  { rank: 3, suit: 'clubs' },
  { rank: 7, suit: 'hearts' },
  { rank: 7, suit: 'spades' },
  { rank: 2, suit: 'diamonds' },
]);

describe('moveHandCard', () => {
  it('moves cards in either direction, including both ends of the hand', () => {
    expect(moveHandCard(cards, cards[0], 3)).toEqual([cards[1], cards[2], cards[3], cards[0]]);
    expect(moveHandCard(cards, cards[3], 0)).toEqual([cards[3], cards[0], cards[1], cards[2]]);
    expect(moveHandCard(cards, cards[1], 2)).toEqual([cards[0], cards[2], cards[1], cards[3]]);
    expect(moveHandCard(cards, cards[2], 1)).toEqual([cards[0], cards[2], cards[1], cards[3]]);
  });

  it('matches rank and suit across snapshots without mutating the input', () => {
    const original = structuredClone(cards);
    expect(moveHandCard(cards, { ...cards[2] }, 0)).toEqual([cards[2], cards[0], cards[1], cards[3]]);
    expect(cards).toEqual(original);
  });

  it('preserves order for the same position, unknown cards, and an empty hand', () => {
    expect(moveHandCard(cards, cards[1], 1)).toEqual(cards);
    expect(moveHandCard(cards, { rank: 8, suit: 'clubs' }, 1)).toEqual(cards);
    expect(moveHandCard([], cards[0], 0)).toEqual([]);
  });

  it.each([-1, cards.length, 0.5, NaN, Infinity])('ignores invalid target %s', (target) => {
    expect(moveHandCard(cards, cards[0], target)).toEqual(cards);
  });
});

describe('reconcileHandOrder', () => {
  it('retains manual order after played cards leave the hand', () => {
    const order = [cards[3], cards[1], cards[0], cards[2]];
    expect(reconcileHandOrder([cards[0], cards[2], cards[3]], order))
      .toEqual([cards[3], cards[0], cards[2]]);
  });

  it('uses current snapshot card objects while preserving the previous order', () => {
    const hand = cards.map((card) => ({ ...card }));
    const result = reconcileHandOrder(hand, [...cards].reverse());
    expect(result).toEqual([...cards].reverse());
    expect(result[0]).toBe(hand[3]);
  });

  it('ignores stale and duplicate order entries and appends new cards once', () => {
    const order: readonly Card[] = Object.freeze([
      cards[2], { rank: 5, suit: 'clubs' }, { ...cards[2] }, cards[0],
    ]);
    const originalOrder = structuredClone(order);
    const originalHand = structuredClone(cards);
    expect(reconcileHandOrder(cards, order)).toEqual([cards[2], cards[0], cards[1], cards[3]]);
    expect(order).toEqual(originalOrder);
    expect(cards).toEqual(originalHand);
  });

  it('uses the supplied hand order after manual order is cleared', () => {
    expect(reconcileHandOrder(cards, [])).toEqual(cards);
    expect(reconcileHandOrder([...cards].reverse(), [])).toEqual([...cards].reverse());
    expect(reconcileHandOrder([], cards)).toEqual([]);
  });
});
