// ─── Cards with jokers (pure functions, shared by client and server) ───

import type { Card, CardOrJoker, JokerCard, JokerKind, Suit } from '../types';
import { RANK_ORDER_DESC } from '../constants';

const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** Every joker kind, big first. */
export const JOKER_KINDS: readonly JokerKind[] = ['big', 'small'];

/** How many jokers a deck holds: none, the big joker alone, or both. */
export type JokerCount = 0 | 1 | 2;

export function isJoker(card: CardOrJoker): card is JokerCard {
  return 'joker' in card;
}

export function joker(kind: JokerKind): JokerCard {
  return { joker: kind };
}

/** Stable identity: `S14`, `H2`, `BJ` (big joker), `SJ` (small joker). */
export function cardKey(card: CardOrJoker): string {
  if (isJoker(card)) return card.joker === 'big' ? 'BJ' : 'SJ';
  return `${card.suit[0].toUpperCase()}${card.rank}`;
}

export function sameCard(a: CardOrJoker, b: CardOrJoker): boolean {
  return cardKey(a) === cardKey(b);
}

export function hasCard(cards: readonly CardOrJoker[], card: CardOrJoker): boolean {
  return cards.some((candidate) => sameCard(candidate, card));
}

export function removeCards<T extends CardOrJoker>(cards: readonly T[], removed: readonly CardOrJoker[]): T[] {
  return cards.filter((card) => !hasCard(removed, card));
}

/** Strict payload check: exact keys only, so extra properties never reach state. */
export function isCardOrJoker(value: unknown): value is CardOrJoker {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === 'joker') return record.joker === 'big' || record.joker === 'small';
  return keys.length === 2 && SUITS.includes(record.suit as Suit)
    && (RANK_ORDER_DESC as readonly unknown[]).includes(record.rank);
}

/** `cards` followed by the requested jokers: one is the big joker, two adds the small joker. */
export function withJokers(cards: readonly Card[], jokers: JokerCount): CardOrJoker[] {
  return [...cards, ...JOKER_KINDS.slice(0, jokers).map(joker)];
}

/** The 52 suit cards (clubs to spades, ace down to two) plus 0, 1 or 2 jokers. */
export function createJokerDeck(jokers: JokerCount): CardOrJoker[] {
  return withJokers(SUITS.flatMap((suit) => RANK_ORDER_DESC.map((rank): Card => ({ suit, rank }))), jokers);
}
