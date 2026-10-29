import { omIsPermutation } from '../../rules/oldmaid';
import { actionRecord } from '../action-validation';

/** The deck holds 53 cards, so no hand ever reaches this many. */
const MAX_HAND = 53;

export type OldMaidAction =
  /** Take the card at `index` of the neighbour's hand; `reorder` first rearranges the drawer's own hand (bots). */
  | { readonly type: 'draw'; readonly index: number; readonly reorder?: readonly number[] }
  /** Rearrange the sender's own hand: position `i` takes the card now at `order[i]`. */
  | { readonly type: 'reorder'; readonly order: readonly number[] };

function parseOrder(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || value.length > MAX_HAND) return null;
  const order = value as number[];
  return omIsPermutation(order, order.length) ? [...order] : null;
}

export function parseAction(value: unknown): OldMaidAction | string {
  const action = actionRecord(value);
  if (action?.type === 'reorder') {
    const order = parseOrder(action.order);
    return order ? { type: 'reorder', order } : 'Invalid order.';
  }
  if (action?.type !== 'draw') return 'Invalid action.';
  const { index, reorder } = action;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= MAX_HAND) return 'Invalid position.';
  if (reorder === undefined) return { type: 'draw', index };
  const order = parseOrder(reorder);
  return order ? { type: 'draw', index, reorder: order } : 'Invalid order.';
}
