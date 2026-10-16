import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, LiarCard, NapoleonCard } from '@shared/types';
import { sortBigTwoHand } from '@shared/rules/bigtwo';
import { sameHandCard, sortHand } from '../../../client/src/games/hand-sort';
import { reconcileOrder } from '../../../client/src/components/card-hand-order';
import { useHandSortStore } from '../../../client/src/stores/hand-sort-store';

const cards: readonly Card[] = [
  { suit: 'clubs', rank: 2 }, { suit: 'hearts', rank: 14 },
  { suit: 'spades', rank: 3 }, { suit: 'clubs', rank: 14 },
];

describe('hand sorting controls', () => {
  beforeEach(() => useHandSortStore.setState({ gameType: null, order: null, revision: 0 }));
  it.each(['rank', 'suit'] as const)('retains Big Two rules for %s order', (order) => {
    expect(sortHand(cards, order, 'bigtwo')).toEqual(sortBigTwoHand(cards, order));
  });

  it('sorts ranks low to high without mutating input and retains duplicate cards', () => {
    const hand = Object.freeze([...cards, cards[0]]);
    const before = [...hand];
    expect(sortHand(hand, 'rank', 'ninetynine').map((card) => card.rank)).toEqual([2, 2, 3, 14, 14]);
    expect(hand).toEqual(before);
  });

  it('groups suits and retains the two distinguishable jokers', () => {
    const hand: NapoleonCard[] = [...cards, { joker: 'small' }, { joker: 'big' }];
    const sorted = sortHand(hand, 'suit', 'napoleon');
    expect(sorted.slice(-2)).toEqual([{ joker: 'small' }, { joker: 'big' }]);
    expect(sorted.slice(-4, -2)).toEqual([{ suit: 'clubs', rank: 2 }, { suit: 'clubs', rank: 14 }]);
    expect(sorted).toHaveLength(hand.length);
  });

  it.each(['rank', 'suit'] as const)('puts K to the right of lower ranks in %s mode', (order) => {
    const hand: Card[] = [{ suit: 'hearts', rank: 13 }, { suit: 'hearts', rank: 4 }, { suit: 'hearts', rank: 12 }];
    expect(sortHand(hand, order, 'napoleon').map((card) => card.rank)).toEqual([4, 12, 13]);
  });

  it('sorts Liar cards low to high and preserves distinct copies when manually reordered', () => {
    const hand: LiarCard[] = [{ id: 1, face: 'K' }, { id: 2, face: 'Q' }, { id: 3, face: 'K' }, { id: 4, face: 'joker' }];
    expect(sortHand(hand, 'rank', 'liarsdeck').map((card) => card.id)).toEqual([2, 1, 3, 4]);
    expect(reconcileOrder(hand.slice(1), [hand[2], hand[0], hand[1], hand[3]], sameHandCard).map((card) => card.id))
      .toEqual([3, 2, 4]);
  });

  it('toggles the active sort off and can enable a different sort or game', () => {
    useHandSortStore.getState().sort('napoleon', 'suit');
    const before = useHandSortStore.getState().revision;
    useHandSortStore.getState().sort('napoleon', 'suit');
    expect(useHandSortStore.getState()).toMatchObject({ gameType: 'napoleon', order: null, revision: before + 1 });
    useHandSortStore.getState().sort('napoleon', 'rank');
    expect(useHandSortStore.getState().order).toBe('rank');
    useHandSortStore.getState().sort('napoleon', 'suit');
    expect(useHandSortStore.getState().order).toBe('suit');
    useHandSortStore.getState().sort('bigtwo', 'suit');
    expect(useHandSortStore.getState()).toMatchObject({ gameType: 'bigtwo', order: 'suit' });
  });
});
