import type { NapoleonCard } from '@shared/types';
import { sameNapoleonCard as sameCard } from '@shared/rules/napoleon';

/** Preserve the player's order while dropping played cards and appending new cards. */
export function reconcileHandOrder<T extends NapoleonCard>(hand: readonly T[], order: readonly T[]): T[] {
  return reconcileOrder(hand, order, sameCard);
}

export function reconcileOrder<T>(hand: readonly T[], order: readonly T[], same: (a: T, b: T) => boolean): T[] {
  const remaining = [...hand];
  const result: T[] = [];
  for (const card of order) {
    const index = remaining.findIndex((candidate) => same(candidate, card));
    if (index >= 0) result.push(...remaining.splice(index, 1));
  }
  return [...result, ...remaining];
}

export function moveHandCard<T extends NapoleonCard>(hand: readonly T[], card: T, target: number): T[] {
  const source = hand.findIndex((candidate) => sameCard(candidate, card));
  return moveHandCardAt(hand, source, target);
}

export function moveHandCardAt<T>(hand: readonly T[], source: number, target: number): T[] {
  const result = [...hand];
  if (!Number.isInteger(source) || source < 0 || source >= hand.length
    || !Number.isInteger(target) || target < 0 || target >= hand.length) return result;
  const [moved] = result.splice(source, 1);
  result.splice(target, 0, moved);
  return result;
}
