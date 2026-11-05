import { actionRecord, parseCard } from '../action-validation';
import type { SpadesAction } from './types';
export type { SpadesAction } from './types';

export function parseAction(value: unknown): SpadesAction | string {
  const action = actionRecord(value);
  if (action?.type === 'bid' && Number.isInteger(action.bid) && typeof action.bid === 'number'
    && action.bid >= 0 && action.bid <= 13) return { type: 'bid', bid: action.bid };
  if (action?.type === 'play') {
    const card = parseCard(action.card);
    if (card) return { type: 'play', card };
  }
  return 'Invalid Spades action.';
}
