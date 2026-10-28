import type { Card } from '../types/game';

export function actionRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Copies only public card fields before an action reaches game state. */
export function parseCard(value: unknown): Card | null {
  const card = actionRecord(value);
  if (!card || typeof card.rank !== 'number' || !Number.isInteger(card.rank) || card.rank < 2 || card.rank > 14) return null;
  const { suit, rank } = card;
  return suit === 'clubs' || suit === 'diamonds' || suit === 'hearts' || suit === 'spades'
    ? { suit, rank: rank as Card['rank'] } : null;
}

export function parseCards(value: unknown, min: number, max: number): Card[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const cards = Array.from(value, parseCard);
  if (!cards.every((card): card is Card => card !== null)
    || new Set(cards.map(({ suit, rank }) => `${suit}-${rank}`)).size !== cards.length) return null;
  return cards;
}
