import type { TenHalfAction } from '../../types/game';
import { TH_ACTIONS } from '../../rules/tenhalf';
import { BJ_MAX_BET, BJ_MIN_BET } from '../../rules/blackjack';
import { actionRecord } from '../action-validation';

export type TenHalfGameAction =
  | { type: 'bet'; amount: number }
  | { type: 'act'; action: TenHalfAction };

export function parseAction(value: unknown): TenHalfGameAction | string {
  const action = actionRecord(value);
  if (action?.type === 'bet') {
    const { amount } = action;
    return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= BJ_MIN_BET && amount <= BJ_MAX_BET
      ? { type: 'bet', amount } : 'Invalid bet.';
  }
  if (action?.type === 'act' && (TH_ACTIONS as readonly unknown[]).includes(action.action)) {
    return { type: 'act', action: action.action as TenHalfAction };
  }
  return 'Invalid action.';
}
