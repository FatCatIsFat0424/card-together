import type { Card } from '../../types/game';
import { actionRecord, parseCard } from '../action-validation';

export type RedPointsAction = { type: 'play'; card: Card; capture?: Card } | { type: 'chooseFlip'; capture: Card };

export function parseAction(value: unknown): RedPointsAction | string {
  const action = actionRecord(value);
  if (action?.type !== 'play' && action?.type !== 'chooseFlip') return 'Invalid action.';
  const capture = action.capture === undefined ? undefined : parseCard(action.capture);
  if (capture === null) return 'Invalid card.';
  if (action.type === 'chooseFlip') return capture ? { type: 'chooseFlip', capture } : 'Invalid card.';
  const card = parseCard(action.card);
  return card ? { type: 'play', card, ...(capture ? { capture } : {}) } : 'Invalid card.';
}
