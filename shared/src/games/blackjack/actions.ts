import type { BlackjackAction, BlackjackDealerAction } from '../../types/game';
import { BJ_ACTIONS, BJ_DEALER_ACTIONS, BJ_MAX_BET, BJ_MIN_BET } from '../../rules/blackjack';
import { actionRecord } from '../action-validation';

export type BlackjackGameAction =
  | { type: 'bet'; amount: number }
  | { type: 'act'; action: BlackjackAction }
  | { type: 'dealerAct'; action: BlackjackDealerAction };

export function parseAction(value: unknown): BlackjackGameAction | string {
  const action = actionRecord(value);
  if (action?.type === 'bet') {
    const { amount } = action;
    return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= BJ_MIN_BET && amount <= BJ_MAX_BET
      ? { type: 'bet', amount } : 'Invalid bet.';
  }
  if (action?.type === 'act' && (BJ_ACTIONS as readonly unknown[]).includes(action.action)) {
    return { type: 'act', action: action.action as BlackjackAction };
  }
  if (action?.type === 'dealerAct' && (BJ_DEALER_ACTIONS as readonly unknown[]).includes(action.action)) {
    return { type: 'dealerAct', action: action.action as BlackjackDealerAction };
  }
  return 'Invalid action.';
}
