import { CB_SLOTS } from '../../rules/codebreaker';
import { actionRecord } from '../action-validation';

export type CodeBreakerGameAction = { type: 'guess'; code: number[] };

/** Well-formedness against the room's variant is the game's check; this keeps only plain symbols. */
export function parseAction(value: unknown): CodeBreakerGameAction | string {
  const action = actionRecord(value);
  if (action?.type === 'guess') {
    const { code } = action;
    return Array.isArray(code) && code.length === CB_SLOTS
      && code.every((symbol: unknown) => Number.isInteger(symbol) && (symbol as number) >= 0 && (symbol as number) <= 9)
      ? { type: 'guess', code: [...code] as number[] } : 'Invalid guess.';
  }
  return 'Invalid action.';
}
