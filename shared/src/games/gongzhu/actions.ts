import type { Card } from '../../types/game';
import { actionRecord, parseCard } from '../action-validation';

export interface GongZhuAction { readonly type: 'play'; readonly card: Card }
export function parseAction(value: unknown): GongZhuAction | string {
  const action = actionRecord(value);
  const card = parseCard(action?.card);
  return action?.type === 'play' && card ? { type: 'play', card } : 'Invalid action.';
}
