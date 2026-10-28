import { LDI_DICE_PER_PLAYER, LDI_FACES } from '../../rules/liarsdice';
import { MAX_ROOM_SEATS } from '../../constants/game-rules';
import { actionRecord } from '../action-validation';
import type { DiceFace } from './types';

export type LiarsDiceAction =
  | { readonly type: 'bid'; readonly quantity: number; readonly face: DiceFace }
  | { readonly type: 'challenge' };

/** No bid can name more dice than every seat holds at the start of a match. */
const MAX_QUANTITY = LDI_DICE_PER_PLAYER * MAX_ROOM_SEATS;

export function parseAction(value: unknown): LiarsDiceAction | string {
  const action = actionRecord(value);
  if (action?.type === 'challenge') return { type: 'challenge' };
  if (action?.type !== 'bid') return 'Invalid action.';
  const { quantity, face } = action;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY
    || typeof face !== 'number' || !Number.isInteger(face) || face < 1 || face > LDI_FACES) return 'Invalid bid.';
  return { type: 'bid', quantity, face: face as DiceFace };
}
