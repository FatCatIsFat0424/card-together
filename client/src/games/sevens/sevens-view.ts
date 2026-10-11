import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import { svCardPenalty, svIsRowClosed } from '@shared/rules/sevens';
import type { Card, Rank, SevensLogEntry, SevensTable, Suit } from '@shared/types';

const ROW_LENGTH = 13;

/** `played` is on the table, `next` extends or opens the row, `empty` is not reachable yet. */
export type SevensSlotState = 'played' | 'next' | 'empty';

export interface SevensSlot {
  readonly order: number;
  readonly card: Card;
  readonly state: SevensSlotState;
  /** The local player may play this card now */
  readonly target: boolean;
}

export interface SevensRow {
  readonly suit: Suit;
  readonly open: boolean;
  readonly closed: boolean;
  readonly slots: readonly SevensSlot[];
}

/** What the local player's hand does right now. */
export type SevensHandMode = 'play' | 'cover' | 'wait';

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Inverse of `svOrder`: A sits at order 1. */
export function rankAtOrder(order: number): Rank {
  if (!Number.isInteger(order) || order < 1 || order > ROW_LENGTH) throw new Error('order out of range');
  return (order === 1 ? 14 : order) as Rank;
}

/** Thirteen A…K slots per suit in display order; targets mark where the player's valid cards would land. */
export function sevensRows(table: SevensTable, targets: readonly Card[], closeOnEnd = false): SevensRow[] {
  return SUIT_DISPLAY_ORDER.map((suit) => {
    const row = table[suit];
    const closed = svIsRowClosed(row, closeOnEnd);
    const slots = Array.from({ length: ROW_LENGTH }, (_, index): SevensSlot => {
      const order = index + 1;
      const card: Card = { suit, rank: rankAtOrder(order) };
      const state: SevensSlotState = row
        ? order >= row.low && order <= row.high ? 'played'
          : !closed && (order === row.low - 1 || order === row.high + 1) ? 'next' : 'empty'
        : order === 7 ? 'next' : 'empty';
      return { order, card, state, target: state === 'next' && targets.some((target) => sameCard(target, card)) };
    });
    return { suit, open: row !== null, closed, slots };
  });
}

/**
 * The server sends no valid cards when it is not the player's turn, and also when the
 * player must cover, so an empty list only means "cover" on the player's own turn.
 */
export function sevensHandMode(isMyTurn: boolean, validCards: readonly Card[], handSize: number): SevensHandMode {
  if (!isMyTurn || handSize === 0) return 'wait';
  return validCards.length > 0 ? 'play' : 'cover';
}

/** Keep a cover selection only while it is still a card in hand. */
export function coverSelection(selected: Card | null, hand: readonly Card[]): Card | null {
  return selected && hand.some((card) => sameCard(card, selected)) ? selected : null;
}

/** Penalty after covering `card`, so the confirmation shows its cost. */
export function coverCost(card: Card, covered: readonly Card[]): { penalty: number; total: number } {
  const penalty = svCardPenalty(card);
  return { penalty, total: covered.reduce((sum, item) => sum + svCardPenalty(item), penalty) };
}

/** The most recent card placed on the table, for highlighting. */
export function lastPlayedCard(log: readonly SevensLogEntry[]): Card | null {
  for (let index = log.length - 1; index >= 0; index--) {
    const entry = log[index];
    if (entry.type === 'play') return entry.card;
  }
  return null;
}

/** Newest first, limited to `limit` entries. */
export function recentMoves(log: readonly SevensLogEntry[], limit: number): SevensLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}
