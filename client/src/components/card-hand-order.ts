import type { Card } from '@shared/types';

function sameCard(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** Preserve the player's order while dropping played cards and appending new cards. */
export function reconcileHandOrder(hand: readonly Card[], order: readonly Card[]): Card[] {
  const remaining = [...hand];
  const result: Card[] = [];
  for (const card of order) {
    const index = remaining.findIndex((candidate) => sameCard(candidate, card));
    if (index >= 0) result.push(...remaining.splice(index, 1));
  }
  return [...result, ...remaining];
}

export function moveHandCard(hand: readonly Card[], card: Card, target: number): Card[] {
  const result = [...hand];
  const source = result.findIndex((candidate) => sameCard(candidate, card));
  if (source < 0 || !Number.isInteger(target) || target < 0 || target >= hand.length) return result;
  const [moved] = result.splice(source, 1);
  result.splice(target, 0, moved);
  return result;
}
