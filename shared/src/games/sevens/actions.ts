import type { Card } from '../../types/game';
import { actionRecord, parseCard } from '../action-validation';

export type SevensAction = { type: 'play' | 'cover'; card: Card };

export function parseAction(value: unknown): SevensAction | string {
  const action = actionRecord(value);
  if (action?.type !== 'play' && action?.type !== 'cover') return 'Invalid action.';
  const card = parseCard(action.card);
  return card ? { type: action.type, card } : 'Invalid card.';
}
