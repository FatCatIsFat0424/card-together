// ─── Deck Engine: deck creation and shuffling ───

import type { Card, CardOrJoker, Suit, Rank } from '@shared/types';
import { withJokers, type JokerCount } from '@shared/rules/cards';

const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * Create a standard 52-card deck
 * Ordered by suit then rank: ♠A-2, ♥A-2, ♣A-2, ♦A-2
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/** The standard deck plus 0, 1 (big) or 2 jokers appended; the 52 suit cards keep `createDeck()` order. */
export function createJokerDeck(jokers: JokerCount): CardOrJoker[] {
  return withJokers(createDeck(), jokers);
}

/**
 * Fisher-Yates shuffle
 * @param deck - Source deck (not modified)
 * @param randomFn - Random function (defaults to Math.random); inject a seeded one for reproducibility
 * @returns A new shuffled array
 */
export function shuffleDeck<T = Card>(
  deck: readonly T[],
  randomFn: () => number = Math.random,
): T[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
