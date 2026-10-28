import type { BidAction, Card } from '../../types/game';
import { actionRecord, parseCard } from '../action-validation';

export type BridgeAction =
  | { type: 'bid'; bid: BidAction }
  | { type: 'play'; card: Card }
  | { type: 'redeal'; accept: boolean };

export function parseAction(value: unknown): BridgeAction | string {
  const action = actionRecord(value);
  if (action?.type === 'redeal') return typeof action.accept === 'boolean'
    ? { type: 'redeal', accept: action.accept } : 'Invalid redeal response.';
  if (action?.type === 'play') {
    const card = parseCard(action.card);
    return card ? { type: 'play', card } : 'Invalid card.';
  }
  if (action?.type !== 'bid') return 'Invalid action.';
  const bid = actionRecord(action.bid);
  if (bid?.type === 'pass') return { type: 'bid', bid: { type: 'pass' } };
  if (bid?.type !== 'bid' || typeof bid.level !== 'number' || !Number.isInteger(bid.level)
    || bid.level < 1 || bid.level > 7) return 'Invalid bid.';
  const { suit } = bid;
  if (suit !== 'clubs' && suit !== 'diamonds' && suit !== 'hearts' && suit !== 'spades' && suit !== 'nt') return 'Invalid bid.';
  return { type: 'bid', bid: { type: 'bid', level: bid.level as 1 | 2 | 3 | 4 | 5 | 6 | 7, suit } };
}
