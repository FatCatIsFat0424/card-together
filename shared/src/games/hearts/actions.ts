import type { Card } from '../../types';
import type { HeartsAction } from './types';
import { isCardOrJoker, isJoker, cardKey } from '../../rules/cards';
import { actionRecord } from '../action-validation';
export type { HeartsAction } from './types';
function parseCard(value: unknown): Card | null {
  return isCardOrJoker(value) && !isJoker(value) ? { suit: value.suit, rank: value.rank } : null;
}
export function parseAction(value: unknown): HeartsAction | string {
  const action = actionRecord(value);
  if (action?.type === 'play') {
    const card = parseCard(action.card);
    if (card) return { type: 'play', card };
  }
  if (action?.type === 'pass' && Array.isArray(action.cards) && action.cards.length === 3) {
    const cards = Array.from(action.cards, parseCard);
    if (cards.every((card): card is Card => card !== null) && new Set(cards.map(cardKey)).size === 3) {
      return { type: 'pass', cards };
    }
  }
  return 'Invalid action.';
}
