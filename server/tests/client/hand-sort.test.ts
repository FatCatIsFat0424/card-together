import { beforeEach, describe, expect, it } from 'vitest';
import type { Card, LiarCard, NapoleonCard } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';
import { sortBigTwoHandHighFirst } from '@shared/rules/bigtwo';
import { ldSortHand } from '@shared/rules/liarsdeck';
import { sortNapoleonHand } from '@shared/rules/napoleon';
import { svSortHand } from '@shared/rules/sevens';
import { sortHand as dealtBridgeHand } from '../../src/engine/dealing';
import { sameHandCard, sortHand } from '../../../client/src/games/hand-sort';
import { reconcileOrder } from '../../../client/src/components/card-hand-order';
import { handArrangement, useHandSortStore } from '../../../client/src/stores/hand-sort-store';
import { clientGame } from '../../../client/src/games/registry';

const cards: readonly Card[] = [
  { suit: 'clubs', rank: 2 }, { suit: 'hearts', rank: 14 },
  { suit: 'spades', rank: 3 }, { suit: 'clubs', rank: 14 },
];

describe('hand sorting controls', () => {
  beforeEach(() => useHandSortStore.setState({ gameType: null, order: null, manual: false }));
  it.each(['rank', 'suit'] as const)('retains Big Two rules for %s order', (order) => {
    expect(sortHand(cards, order, 'bigtwo')).toEqual(sortBigTwoHandHighFirst(cards, order));
  });

  it('sorts ranks high to low without mutating input and retains duplicate cards', () => {
    const hand = Object.freeze([...cards, cards[0]]);
    const before = [...hand];
    expect(sortHand(hand, 'rank', 'ninetynine').map((card) => card.rank)).toEqual([14, 14, 3, 2, 2]);
    expect(hand).toEqual(before);
  });

  it('groups suits, high to low in each, and leads Napoleon hands with the jokers', () => {
    const hand: NapoleonCard[] = [{ joker: 'small' }, ...cards, { joker: 'big' }];
    const sorted = sortHand(hand, 'suit', 'napoleon');
    expect(sorted.slice(0, 2)).toEqual([{ joker: 'big' }, { joker: 'small' }]);
    expect(sorted.slice(2)).toEqual([
      { suit: 'spades', rank: 3 }, { suit: 'hearts', rank: 14 }, { suit: 'clubs', rank: 14 }, { suit: 'clubs', rank: 2 },
    ]);
    expect(sorted).toHaveLength(hand.length);
  });

  it('puts the Napoleon trump suit first, as the server deals it', () => {
    const hand: NapoleonCard[] = [...cards, { joker: 'big' }];
    expect(sortHand(hand, 'suit', 'napoleon', 'clubs')).toEqual(sortNapoleonHand(hand, 'clubs'));
    expect(sortHand(hand, 'suit', 'napoleon', 'nt')).toEqual(sortNapoleonHand(hand, 'nt'));
  });

  it.each(['rank', 'suit'] as const)('puts K to the left of lower ranks in %s mode', (order) => {
    const hand: Card[] = [{ suit: 'hearts', rank: 4 }, { suit: 'hearts', rank: 13 }, { suit: 'hearts', rank: 12 }];
    expect(sortHand(hand, order, 'napoleon').map((card) => card.rank)).toEqual([13, 12, 4]);
  });

  it('keeps the suit order of every game identical between by-suit and the dealt order', () => {
    const hand: Card[] = [
      { suit: 'diamonds', rank: 5 }, { suit: 'spades', rank: 9 }, { suit: 'clubs', rank: 13 }, { suit: 'hearts', rank: 7 },
      { suit: 'spades', rank: 14 }, { suit: 'hearts', rank: 3 },
    ];
    const suits = (list: readonly Card[]): string[] => list.map((card) => card.suit);
    const grouped = ['spades', 'spades', 'hearts', 'hearts', 'clubs', 'diamonds'];
    expect(suits(dealtBridgeHand(hand))).toEqual(grouped);
    for (const game of GAME_TYPES.filter((type) => !['liarsdeck', 'bigtwo'].includes(type))) {
      expect(suits(sortHand(hand, 'suit', game))).toEqual(grouped);
    }
    expect(suits(sortBigTwoHandHighFirst(hand, 'suit'))).toEqual(['spades', 'spades', 'hearts', 'hearts', 'diamonds', 'clubs']);
  });

  it.each(GAME_TYPES.filter((type) => type !== 'liarsdeck'))('puts the strongest rank on the left in %s', (game) => {
    const hand: Card[] = [
      { suit: 'clubs', rank: 5 }, { suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 2 }, { suit: 'diamonds', rank: 13 },
      { suit: 'clubs', rank: 9 },
    ];
    // Big Two and Dou Dizhu rank 2 highest and 3 lowest; Sevens ranks K highest and the ace lowest.
    const [strongest, weakest] = game === 'bigtwo' || game === 'doudizhu' ? [2, 5] : game === 'sevens' ? [13, 14] : [14, 2];
    const sorted = sortHand(hand, 'rank', game);
    expect(sorted[0].rank).toBe(strongest);
    expect(sorted.at(-1)!.rank).toBe(weakest);
  });

  it('shows the dealt Sevens, Big Two and Liar hands in the same direction as the sort buttons', () => {
    const hand: Card[] = [{ suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 }, { suit: 'hearts', rank: 7 }];
    expect(sortHand(hand, 'suit', 'sevens')).toEqual(svSortHand(hand));
    const liars: LiarCard[] = [{ id: 1, face: 'K' }, { id: 2, face: 'joker' }, { id: 3, face: 'Q' }, { id: 4, face: 'A' }];
    expect(sortHand(liars, 'rank', 'liarsdeck')).toEqual(ldSortHand(liars));
  });

  it('sorts Liar cards joker, A, K, Q and preserves distinct copies when manually reordered', () => {
    const hand: LiarCard[] = [{ id: 1, face: 'K' }, { id: 2, face: 'Q' }, { id: 3, face: 'K' }, { id: 4, face: 'joker' }];
    expect(sortHand(hand, 'rank', 'liarsdeck').map((card) => card.id)).toEqual([4, 1, 3, 2]);
    expect(reconcileOrder(hand.slice(1), [hand[2], hand[0], hand[1], hand[3]], sameHandCard).map((card) => card.id))
      .toEqual([3, 2, 4]);
  });

  it('keeps the active sort when it is pressed again and can switch sort or game', () => {
    useHandSortStore.getState().sort('napoleon', 'suit');
    useHandSortStore.getState().sort('napoleon', 'suit');
    expect(useHandSortStore.getState()).toMatchObject({ gameType: 'napoleon', order: 'suit', manual: false });
    useHandSortStore.getState().sort('napoleon', 'rank');
    expect(useHandSortStore.getState().order).toBe('rank');
    useHandSortStore.getState().sort('bigtwo', 'suit');
    expect(useHandSortStore.getState()).toMatchObject({ gameType: 'bigtwo', order: 'suit' });
  });

  it('switches to a manual arrangement after a drag and back to a sort when one is pressed', () => {
    useHandSortStore.getState().arrange('bridge', 'suit');
    expect(handArrangement(useHandSortStore.getState(), 'bridge', 'suit')).toEqual({ order: 'suit', manual: true });
    // Another game still starts from its own default.
    expect(handArrangement(useHandSortStore.getState(), 'bigtwo', 'rank')).toEqual({ order: 'rank', manual: false });
    useHandSortStore.getState().sort('bridge', 'suit');
    expect(handArrangement(useHandSortStore.getState(), 'bridge', 'suit')).toEqual({ order: 'suit', manual: false });
  });

  it('starts every game sorted by suit or rank, matching the dealt order where the server sorts hands', () => {
    const initial = Object.fromEntries(GAME_TYPES.map((game) => [game, clientGame(game).handSort.initial]));
    expect(initial).toMatchObject({ bridge: 'suit', napoleon: 'suit', sevens: 'suit', bigtwo: 'rank', liarsdeck: 'rank' });
    for (const game of GAME_TYPES) {
      expect(['suit', 'rank']).toContain(initial[game]);
      if (!clientGame(game).handSort.bySuit) expect(initial[game]).toBe('rank');
    }
    const hand: Card[] = [{ suit: 'diamonds', rank: 5 }, { suit: 'spades', rank: 9 }, { suit: 'clubs', rank: 13 }];
    expect(sortHand(hand, 'suit', 'bridge')).toEqual(dealtBridgeHand(hand));
    expect(sortHand(hand, 'rank', 'bigtwo')).toEqual(sortBigTwoHandHighFirst(hand));
  });
});
