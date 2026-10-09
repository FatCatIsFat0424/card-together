// ─── Card face SVGs (cardsJS, LGPL-3.0, see assets/cards/) ───

import type { Card, Rank, Suit } from '@shared/types';

const CARD_URLS = import.meta.glob('./assets/cards/*.svg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

const RANK_CODES: Record<Rank, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const SUIT_CODES: Record<Suit, string> = { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' };

export function cardImageUrl(card: Card): string {
  const url = CARD_URLS[`./assets/cards/${RANK_CODES[card.rank]}${SUIT_CODES[card.suit]}.svg`];
  if (!url) throw new Error(`Missing card image: ${card.rank} ${card.suit}`);
  return url;
}
