// ─── Sevens (排七) rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#sevens

import type { Card, Seat, SevensTable, Suit } from '../types';
import { SEAT_ORDER_CLOCKWISE, SUIT_DISPLAY_ORDER } from '../constants';

export const SV_HAND_SIZE = 13;
const SV_SEVEN = 7;
const SV_LOW_END = 1;
const SV_HIGH_END = 13;

/** Position in a suit row: A=1 at the low end, 2-10 face value, J=11, Q=12, K=13. */
export function svOrder(card: Card): number {
  return card.rank === 14 ? 1 : card.rank;
}

export function svEmptyTable(): SevensTable {
  return { spades: null, hearts: null, clubs: null, diamonds: null };
}

/** The very first play must be the spade seven; afterwards a card must open or extend its suit row. */
export function svIsPlayable(table: SevensTable, card: Card, firstPlay: boolean): boolean {
  if (firstPlay) return card.suit === 'spades' && card.rank === SV_SEVEN;
  const row = table[card.suit];
  const order = svOrder(card);
  if (!row) return order === SV_SEVEN;
  return order === row.low - 1 || order === row.high + 1;
}

/** Playable cards in hand order. */
export function svLegalPlays(hand: readonly Card[], table: SevensTable, firstPlay: boolean): Card[] {
  return hand.filter((card) => svIsPlayable(table, card, firstPlay));
}

/** Returns a new table with the card placed; throws when the card does not open or extend its row. */
export function svApply(table: SevensTable, card: Card): SevensTable {
  if (!svIsPlayable(table, card, false)) throw new Error('card not playable');
  const row = table[card.suit];
  const order = svOrder(card);
  const next = row
    ? { low: Math.min(row.low, order), high: Math.max(row.high, order) }
    : { low: order, high: order };
  return { ...table, [card.suit]: next };
}

export function svCardPenalty(card: Card): number {
  return svOrder(card);
}

export function svPenalty(cards: readonly Card[]): number {
  return cards.reduce((sum, card) => sum + svCardPenalty(card), 0);
}

/** Seats with the lowest penalty, ordered N, E, S, W. */
export function svWinners(penalties: Record<Seat, number>): Seat[] {
  const lowest = Math.min(...SEAT_ORDER_CLOCKWISE.map((seat) => penalties[seat]));
  return SEAT_ORDER_CLOCKWISE.filter((seat) => penalties[seat] === lowest);
}

/** Every card currently laid out on the table, suit by suit from low to high. */
export function svTableCards(table: SevensTable): Card[] {
  const cards: Card[] = [];
  for (const suit of SUIT_DISPLAY_ORDER) {
    const row = table[suit];
    if (!row) continue;
    for (let order = row.low; order <= row.high; order++) cards.push(svCardAt(suit, order));
  }
  return cards;
}

/** Hand display order: suit, then ace-low order. */
export function svSortHand(hand: readonly Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit);
    return suitDiff !== 0 ? suitDiff : svOrder(a) - svOrder(b);
  });
}

function svCardAt(suit: Suit, order: number): Card {
  if (order < SV_LOW_END || order > SV_HIGH_END) throw new Error('order out of range');
  return { suit, rank: (order === SV_LOW_END ? 14 : order) as Card['rank'] };
}
