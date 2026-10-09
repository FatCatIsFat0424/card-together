// ─── Red Points rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#red-points

import type { Card } from '../types';

export const RP_HAND_SIZE = 6;
export const RP_TABLE_SIZE = 4;

/** Ace counts as 1; other cards use their rank */
function pairValue(card: Card): number {
  return card.rank === 14 ? 1 : card.rank;
}

/** A-9 pair when they sum to 10; 10, J, Q, K only match the same rank */
export function rpCanPair(a: Card, b: Card): boolean {
  const va = pairValue(a);
  const vb = pairValue(b);
  if (va >= 10 || vb >= 10) return va === vb;
  return va + vb === 10;
}

/** Table cards that can be paired with card */
export function rpPairOptions(card: Card, table: readonly Card[]): Card[] {
  return table.filter((t) => rpCanPair(card, t));
}

/** Red ace 20, red 2-9 face value, red 10-K 10, black cards 0 */
export function rpCardPoints(card: Card): number {
  if (card.suit !== 'hearts' && card.suit !== 'diamonds') return 0;
  if (card.rank === 14) return 20;
  return card.rank >= 10 ? 10 : card.rank;
}

export function rpScore(captured: readonly Card[]): number {
  return captured.reduce((sum, card) => sum + rpCardPoints(card), 0);
}

/** Redeal when three or more table cards share a rank */
export function rpNeedsRedeal(table: readonly Card[]): boolean {
  const counts = new Map<number, number>();
  for (const card of table) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 3);
}
