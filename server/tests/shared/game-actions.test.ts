import { describe, expect, expectTypeOf, it } from 'vitest';
import { isNapoleonCard } from '@shared/rules/napoleon';
import { GAME_TYPES } from '@shared/constants';
import { parseGameAction } from '@shared/games/actions';
import type { GameActionEnvelope } from '@shared/games/actions';
import type { BridgeAction } from '@shared/games/bridge/actions';
import type { Card, GameType } from '@shared/types';

const card = { suit: 'clubs', rank: 2 } as const;
const other = { suit: 'hearts', rank: 14 } as const;
const row = (from: number, size: number): Card[] => Array.from({ length: size }, (_, index) => ({
  suit: 'spades', rank: (from + index) as Card['rank'],
}));
const arrangement = { front: row(2, 3), middle: row(5, 5), back: row(10, 5) };

const ACTIONS = [
  { gameType: 'bridge', action: { type: 'bid', bid: { type: 'pass' } } },
  { gameType: 'bridge', action: { type: 'bid', bid: { type: 'bid', level: 7, suit: 'nt' } } },
  { gameType: 'bridge', action: { type: 'play', card } },
  { gameType: 'bridge', action: { type: 'redeal', accept: false } },
  { gameType: 'bigtwo', action: { type: 'play', cards: [card, other] } },
  { gameType: 'bigtwo', action: { type: 'pass' } },
  { gameType: 'redpoints', action: { type: 'play', card, capture: other } },
  { gameType: 'redpoints', action: { type: 'play', card } },
  { gameType: 'redpoints', action: { type: 'chooseFlip', capture: card } },
  { gameType: 'ninetynine', action: { type: 'play', card, choice: 'minus', target: 'P8' } },
  { gameType: 'sevens', action: { type: 'play', card } },
  { gameType: 'sevens', action: { type: 'cover', card } },
  { gameType: 'chinesepoker', action: { type: 'arrange', arrangement } },
  { gameType: 'liarsdeck', action: { type: 'play', cardIds: [0, 1, 2] } },
  { gameType: 'liarsdeck', action: { type: 'challenge' } },
  { gameType: 'blackjack', action: { type: 'bet', amount: 20 } },
  { gameType: 'blackjack', action: { type: 'act', action: 'split' } },
  { gameType: 'blackjack', action: { type: 'dealerAct', action: 'stand' } },
  { gameType: 'tenhalf', action: { type: 'bet', amount: 20 } },
  { gameType: 'tenhalf', action: { type: 'act', action: 'hit' } },
  { gameType: 'doudizhu', action: { type: 'bid', score: 2 } },
  { gameType: 'doudizhu', action: { type: 'claim', take: true } },
  { gameType: 'doudizhu', action: { type: 'play', cards: [card, { joker: 'small' }] } },
  { gameType: 'doudizhu', action: { type: 'pass' } },
  { gameType: 'holdem', action: { type: 'fold' } },
  { gameType: 'holdem', action: { type: 'check' } },
  { gameType: 'holdem', action: { type: 'call' } },
  { gameType: 'holdem', action: { type: 'raise', to: 40 } },
  { gameType: 'stud', action: { type: 'check' } },
  { gameType: 'stud', action: { type: 'raise', to: 40 } },
  { gameType: 'napoleon', action: { type: 'review' } },
  { gameType: 'napoleon', action: { type: 'bid', action: { type: 'pass' } } },
  { gameType: 'napoleon', action: { type: 'bid', action: { type: 'bid', level: 13, suit: 'spades' } } },
  { gameType: 'napoleon', action: { type: 'discard', cards: [card, { joker: 'big' }] } },
  { gameType: 'napoleon', action: { type: 'call', card: other } },
  { gameType: 'napoleon', action: { type: 'play', card: { joker: 'small' }, leadSuit: 'hearts', summon: 'secretary' } },
  { gameType: 'liarsdice', action: { type: 'bid', quantity: 12, face: 6 } },
  { gameType: 'liarsdice', action: { type: 'challenge' } },
  { gameType: 'reversi', action: { type: 'place', to: '3,5' } },
  { gameType: 'reversi', action: { type: 'offer-draw' } },
  { gameType: 'reversi', action: { type: 'answer-draw', accept: true } },
  { gameType: 'jungle', action: { type: 'move', from: '0,6', to: '0,5' } },
  { gameType: 'jungle', action: { type: 'resign' } },
  { gameType: 'crazyeights', action: { type: 'play', card, suit: 'hearts' } },
  { gameType: 'crazyeights', action: { type: 'play', card } },
  { gameType: 'crazyeights', action: { type: 'draw' } },
  { gameType: 'crazyeights', action: { type: 'pass' } },
  { gameType: 'oldmaid', action: { type: 'draw', index: 3 } },
  { gameType: 'oldmaid', action: { type: 'draw', index: 0, reorder: [2, 0, 1] } },
  { gameType: 'oldmaid', action: { type: 'reorder', order: [1, 0] } },
  { gameType: 'oldmaid', action: { type: 'reorder', order: [] } },
  { gameType: 'gofish', action: { type: 'ask', target: 'P6', rank: 14 } },
] satisfies readonly GameActionEnvelope[];

function inject(value: unknown, strictCards = false): unknown {
  // Cards of the joker games are validated strictly, so extra keys reject them instead of being stripped.
  if (strictCards && isNapoleonCard(value)) return { ...value };
  if (Array.isArray(value)) return value.map((entry) => inject(entry, strictCards));
  return value && typeof value === 'object'
    ? { ...Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, inject(entry, strictCards)])), injected: 'untrusted' }
    : value;
}

function expectDetached(actual: unknown, input: unknown): void {
  if (!actual || typeof actual !== 'object' || !input || typeof input !== 'object') return;
  expect(actual).not.toBe(input);
  for (const [key, value] of Object.entries(actual)) expectDetached(value, (input as Record<string, unknown>)[key]);
}

describe('game action contracts', () => {
  it('keeps the envelope discriminated by game type and covers every registered game', () => {
    expectTypeOf<GameActionEnvelope<'bridge'>['action']>().toEqualTypeOf<BridgeAction>();
    expectTypeOf<{ gameType: 'bridge'; action: { type: 'challenge' } }>().not.toExtend<GameActionEnvelope>();
    expect([...new Set(ACTIONS.map((entry) => entry.gameType))].sort()).toEqual([...GAME_TYPES].sort());
  });

  it.each(ACTIONS)('sanitizes $gameType $action.type without retaining input references', (expected) => {
    const input = inject(expected, expected.gameType === 'napoleon' || expected.gameType === 'doudizhu');
    const before = structuredClone(input);
    const parsed = parseGameAction(input);
    expect(parsed).toEqual(expected);
    expect(input).toEqual(before);
    expectDetached(parsed, input);
  });

  it.each(GAME_TYPES)('rejects absent, primitive, and unknown actions for %s', (gameType) => {
    for (const action of [null, undefined, 1, '', [], {}, { type: 'unknown' }]) {
      expect(typeof parseGameAction({ gameType, action })).toBe('string');
    }
  });

  const malformed: readonly [GameType, unknown, string][] = [
    ['bridge', { type: 'bid', bid: { type: 'bid', level: 1.5, suit: 'clubs' } }, 'Invalid bid.'],
    ['bridge', { type: 'bid', bid: { type: 'bid', level: 1, suit: 'joker' } }, 'Invalid bid.'],
    ['bridge', { type: 'redeal', accept: 1 }, 'Invalid redeal response.'],
    ['bridge', { type: 'play', card: { ...card, rank: Infinity } }, 'Invalid card.'],
    ['bigtwo', { type: 'play', cards: [] }, 'Invalid cards.'],
    ['bigtwo', { type: 'play', cards: [card, card] }, 'Invalid cards.'],
    ['bigtwo', { type: 'play', cards: Array(2) }, 'Invalid cards.'],
    ['bigtwo', { type: 'play', cards: row(2, 6) }, 'Invalid cards.'],
    ['redpoints', { type: 'play', card, capture: null }, 'Invalid card.'],
    ['redpoints', { type: 'chooseFlip' }, 'Invalid card.'],
    ['ninetynine', { type: 'play', card, choice: 'double' }, 'Invalid choice.'],
    ['ninetynine', { type: 'play', card, target: 'P9' }, 'Invalid target.'],
    ['sevens', { type: 'cover', card: { ...card, suit: 'joker' } }, 'Invalid card.'],
    ['chinesepoker', { type: 'arrange', arrangement: { ...arrangement, front: [card] } }, 'Invalid arrangement.'],
    ['chinesepoker', { type: 'arrange', arrangement: { ...arrangement, front: [card, card, card] } }, 'Invalid arrangement.'],
    ['chinesepoker', { type: 'arrange', arrangement: { ...arrangement, back: [...arrangement.back.slice(0, 4), arrangement.front[0]] } }, 'Invalid arrangement.'],
    ['liarsdeck', { type: 'play', cardIds: [0, 0] }, 'Invalid cards.'],
    ['liarsdeck', { type: 'play', cardIds: [20] }, 'Invalid cards.'],
    ['liarsdeck', { type: 'play', cardIds: [0, 1, 2, 3] }, 'Invalid cards.'],
    ['liarsdeck', { type: 'play', cardIds: Array(1) }, 'Invalid cards.'],
    ['blackjack', { type: 'bet', amount: Number.MAX_SAFE_INTEGER + 1 }, 'Invalid bet.'],
    ['blackjack', { type: 'bet', amount: 0 }, 'Invalid bet.'],
    ['blackjack', { type: 'act', action: 'surrender' }, 'Invalid action.'],
    ['blackjack', { type: 'dealerAct', action: 'split' }, 'Invalid action.'],
    ['reversi', { type: 'place', to: '8,0' }, 'Invalid action.'],
    ['reversi', { type: 'answer-draw' }, 'Invalid draw answer.'],
    ['jungle', { type: 'move', from: '0,6', to: '7,0' }, 'Invalid action.'],
    ['jungle', { type: 'move', to: '0,5' }, 'Invalid action.'],
    ['jungle', { type: 'place', to: '0,5' }, 'Invalid action.'],
    ['liarsdice', { type: 'bid', quantity: 0, face: 3 }, 'Invalid bid.'],
    ['liarsdice', { type: 'bid', quantity: 41, face: 3 }, 'Invalid bid.'],
    ['liarsdice', { type: 'bid', quantity: 2.5, face: 3 }, 'Invalid bid.'],
    ['liarsdice', { type: 'bid', quantity: 2, face: 7 }, 'Invalid bid.'],
    ['liarsdice', { type: 'bid', quantity: 2, face: 0 }, 'Invalid bid.'],
    ['liarsdice', { type: 'bid', quantity: 2 }, 'Invalid bid.'],
    ['oldmaid', { type: 'draw', index: -1 }, 'Invalid position.'],
    ['oldmaid', { type: 'draw', index: 1.5 }, 'Invalid position.'],
    ['oldmaid', { type: 'draw', index: 53 }, 'Invalid position.'],
    ['oldmaid', { type: 'draw', index: '1' }, 'Invalid position.'],
    ['oldmaid', { type: 'draw', index: 0, reorder: [0, 0] }, 'Invalid order.'],
    ['oldmaid', { type: 'draw', index: 0, reorder: [1] }, 'Invalid order.'],
    ['oldmaid', { type: 'reorder', order: [0, 2] }, 'Invalid order.'],
    ['oldmaid', { type: 'reorder', order: 'abc' }, 'Invalid order.'],
    ['oldmaid', { type: 'reorder' }, 'Invalid order.'],
    ['oldmaid', { type: 'shuffle' }, 'Invalid action.'],
    ['holdem', { type: 'raise', to: 1.5 }, 'Invalid action.'],
    ['holdem', { type: 'raise', to: NaN }, 'Invalid action.'],
    ['stud', { type: 'raise', to: 1.5 }, 'Invalid action.'],
    ['napoleon', { type: 'bid', action: { type: 'bid', level: 1, suit: 'clubs' } }, 'Invalid action.'],
    ['napoleon', { type: 'call', card: { ...card, injected: 'x' } }, 'Invalid action.'],
    ['napoleon', { type: 'call', card: { joker: 'big', suit: 'clubs' } }, 'Invalid action.'],
    ['napoleon', { type: 'discard', cards: [card, card] }, 'Invalid action.'],
    ['napoleon', { type: 'discard', cards: Array(2) }, 'Invalid action.'],
    ['napoleon', { type: 'play', card, leadSuit: 'nt' }, 'Invalid action.'],
    ['napoleon', { type: 'play', card, summon: 'unknown' }, 'Invalid action.'],
    ['crazyeights', { type: 'play', card, suit: 'stars' }, 'Invalid suit.'],
    ['crazyeights', { type: 'play', card: { ...card, rank: 1 } }, 'Invalid card.'],
    ['crazyeights', { type: 'discard' }, 'Invalid action.'],
    ['gofish', { type: 'ask', target: 'X', rank: 7 }, 'Invalid player.'],
    ['gofish', { type: 'ask', target: 'E', rank: 15 }, 'Invalid rank.'],
    ['gofish', { type: 'draw' }, 'Invalid action.'],
  ];
  it.each(malformed)('rejects malformed %s action %#', (gameType, action, error) => {
    expect(parseGameAction({ gameType, action })).toBe(error);
  });
});
