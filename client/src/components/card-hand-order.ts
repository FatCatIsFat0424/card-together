import type { NapoleonCard } from '@shared/types';
import { sameNapoleonCard as sameCard } from '@shared/rules/napoleon';

/** Preserve the player's order while dropping played cards and appending new cards. */
export function reconcileHandOrder<T extends NapoleonCard>(hand: readonly T[], order: readonly T[]): T[] {
  const remaining = [...hand];
  const result: T[] = [];
  for (const card of order) {
    const index = remaining.findIndex((candidate) => sameCard(candidate, card));
    if (index >= 0) result.push(...remaining.splice(index, 1));
  }
  return [...result, ...remaining];
}

export function moveHandCard<T extends NapoleonCard>(hand: readonly T[], card: T, target: number): T[] {
  const result = [...hand];
  const source = result.findIndex((candidate) => sameCard(candidate, card));
  if (source < 0 || !Number.isInteger(target) || target < 0 || target >= hand.length) return result;
  const [moved] = result.splice(source, 1);
  result.splice(target, 0, moved);
  return result;
}
