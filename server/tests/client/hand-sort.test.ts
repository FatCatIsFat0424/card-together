import { describe, expect, it } from 'vitest';
import type { Card, NapoleonCard } from '@shared/types';
import { sortBigTwoHand } from '@shared/rules/bigtwo';
import { sortHand } from '../../../client/src/games/hand-sort';
import { useHandSortStore } from '../../../client/src/stores/hand-sort-store';

const cards: readonly Card[] = [
  { suit: 'clubs', rank: 2 }, { suit: 'hearts', rank: 14 },
  { suit: 'spades', rank: 3 }, { suit: 'clubs', rank: 14 },
];

describe('hand sorting controls', () => {
  it.each(['rank', 'suit'] as const)('retains Big Two rules for %s order', (order) => {
    expect(sortHand(cards, order, 'bigtwo')).toEqual(sortBigTwoHand(cards, order));
  });

  it('sorts ranks high to low without mutating input and retains duplicate cards', () => {
    const hand = Object.freeze([...cards, cards[0]]);
    const before = [...hand];
    expect(sortHand(hand, 'rank', 'ninetynine').map((card) => card.rank)).toEqual([14, 14, 3, 2, 2]);
    expect(hand).toEqual(before);
  });

  it('groups suits and retains the two distinguishable jokers', () => {
    const hand: NapoleonCard[] = [...cards, { joker: 'small' }, { joker: 'big' }];
    const sorted = sortHand(hand, 'suit', 'napoleon');
    expect(sorted.slice(0, 2)).toEqual([{ joker: 'big' }, { joker: 'small' }]);
    expect(sorted.slice(-2)).toEqual([{ suit: 'clubs', rank: 14 }, { suit: 'clubs', rank: 2 }]);
    expect(sorted).toHaveLength(hand.length);
  });

  it('repeating a sort issues a new revision so a dragged hand can be sorted again', () => {
    useHandSortStore.getState().sort('napoleon', 'suit');
    const before = useHandSortStore.getState().revision;
    useHandSortStore.getState().sort('napoleon', 'suit');
    expect(useHandSortStore.getState()).toMatchObject({ gameType: 'napoleon', order: 'suit', revision: before + 1 });
  });
});
