// ─── Deck constants ───

import type { Suit, Rank } from '../types/game';

/** Suit display order (for hand sorting): spades, hearts, clubs, diamonds */
export const SUIT_DISPLAY_ORDER: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

/** Rank order (high to low): A, K, Q, J, 10, 9, ..., 2 */
export const RANK_ORDER_DESC: readonly Rank[] = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2];

/** Suit Unicode symbols */
export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  clubs: '♣',
  diamonds: '♦',
};

/** Rank display labels */
export const RANK_DISPLAY: Record<Rank, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: '10',
  9: '9',
  8: '8',
  7: '7',
  6: '6',
  5: '5',
  4: '4',
  3: '3',
  2: '2',
};

/** High card points (HCP): A=4, K=3, Q=2, J=1, others 0 */
export const HIGH_CARD_POINTS: Record<Rank, number> = {
  14: 4,
  13: 3,
  12: 2,
  11: 1,
  10: 0,
  9: 0,
  8: 0,
  7: 0,
  6: 0,
  5: 0,
  4: 0,
  3: 0,
  2: 0,
};
