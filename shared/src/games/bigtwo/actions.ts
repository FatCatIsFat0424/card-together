import type { Card } from '../../types/game';
import { actionRecord, parseCards } from '../action-validation';

export type BigTwoAction = { type: 'play'; cards: readonly Card[] } | { type: 'pass' };

export function parseAction(value: unknown): BigTwoAction | string {
  const action = actionRecord(value);
  if (action?.type === 'pass') return { type: 'pass' };
  if (action?.type !== 'play') return 'Invalid action.';
  const cards = parseCards(action.cards, 1, 5);
  return cards ? { type: 'play', cards } : 'Invalid cards.';
}
