import type { Card, Suit } from '../../types/game';
import { CE_SUITS } from '../../rules/crazyeights';
import { actionRecord, parseCard } from '../action-validation';

export type CrazyEightsAction =
  | { type: 'play'; card: Card; suit?: Suit }
  | { type: 'draw' }
  | { type: 'pass' };

export function parseAction(value: unknown): CrazyEightsAction | string {
  const action = actionRecord(value);
  if (action?.type === 'draw') return { type: 'draw' };
  if (action?.type === 'pass') return { type: 'pass' };
  if (action?.type !== 'play') return 'Invalid action.';
  const card = parseCard(action.card);
  if (!card) return 'Invalid card.';
  const { suit } = action;
  if (suit !== undefined && !(CE_SUITS as readonly unknown[]).includes(suit)) return 'Invalid suit.';
  return { type: 'play', card, ...(suit !== undefined ? { suit: suit as Suit } : {}) };
}
