// ─── 撿紅點規則引擎（純函式，前後端共用） ───
// Rules: docs/games.md#red-points

import type { Card } from '../types';

export const RP_HAND_SIZE = 6;
export const RP_TABLE_SIZE = 4;

/** A 算 1，其餘為牌面 */
function pairValue(card: Card): number {
  return card.rank === 14 ? 1 : card.rank;
}

/** A～9 相加為 10；10、J、Q、K 只配同點數 */
export function rpCanPair(a: Card, b: Card): boolean {
  const va = pairValue(a);
  const vb = pairValue(b);
  if (va >= 10 || vb >= 10) return va === vb;
  return va + vb === 10;
}

/** 桌面上可與 card 配對的牌 */
export function rpPairOptions(card: Card, table: readonly Card[]): Card[] {
  return table.filter((t) => rpCanPair(card, t));
}

/** 紅 A 20、紅 2～9 牌面、紅 10～K 10、黑牌 0 */
export function rpCardPoints(card: Card): number {
  if (card.suit !== 'hearts' && card.suit !== 'diamonds') return 0;
  if (card.rank === 14) return 20;
  return card.rank >= 10 ? 10 : card.rank;
}

export function rpScore(captured: readonly Card[]): number {
  return captured.reduce((sum, card) => sum + rpCardPoints(card), 0);
}

/** 桌面翻開的牌有 3 張以上同點數時需重發 */
export function rpNeedsRedeal(table: readonly Card[]): boolean {
  const counts = new Map<number, number>();
  for (const card of table) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.values()].some((n) => n >= 3);
}
