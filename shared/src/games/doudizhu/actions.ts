import type { CardOrJoker } from '../../types/game';
import { cardKey, isCardOrJoker } from '../../rules/cards';
import { actionRecord } from '../action-validation';

export type DouDizhuAction =
  /** Score variant: 0 passes, 1-3 bids */
  | { type: 'bid'; score: 0 | 1 | 2 | 3 }
  /** Grab variant: call or grab when `take`, otherwise pass */
  | { type: 'claim'; take: boolean }
  | { type: 'play'; cards: readonly CardOrJoker[] }
  | { type: 'pass' };

/** The most cards one combination can hold: an airplane with wings from a 20-card hand. */
export const DDZ_MAX_PLAY = 20;

function parseCards(value: unknown): CardOrJoker[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > DDZ_MAX_PLAY || !value.every(isCardOrJoker)) return null;
  // Rebuilds each card so caller-supplied extra keys never reach state.
  const cards = value.map((card): CardOrJoker => ('joker' in card ? { joker: card.joker } : { suit: card.suit, rank: card.rank }));
  return new Set(cards.map(cardKey)).size === cards.length ? cards : null;
}

export function parseAction(value: unknown): DouDizhuAction | string {
  const action = actionRecord(value);
  if (action?.type === 'pass') return { type: 'pass' };
  if (action?.type === 'bid') {
    return action.score === 0 || action.score === 1 || action.score === 2 || action.score === 3
      ? { type: 'bid', score: action.score } : 'Invalid bid.';
  }
  if (action?.type === 'claim') return typeof action.take === 'boolean' ? { type: 'claim', take: action.take } : 'Invalid call.';
  if (action?.type === 'play') {
    const cards = parseCards(action.cards);
    return cards ? { type: 'play', cards } : 'Invalid cards.';
  }
  return 'Invalid action.';
}
