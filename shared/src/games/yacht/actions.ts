import { YACHT_DICE, isYachtBox } from '../../rules/yacht';
import type { YachtBox } from '../../rules/yacht';
import { actionRecord } from '../action-validation';

export type YachtGameAction =
  /** Rolls the dice that are not held; `held` first replaces the held dice */
  | { readonly type: 'roll'; readonly held?: readonly boolean[] }
  /** Marks the dice kept for the next roll, visible to the table */
  | { readonly type: 'hold'; readonly held: readonly boolean[] }
  | { readonly type: 'score'; readonly box: YachtBox }
  /** Server-made timeout action: rolls if needed and writes the dice into the best box */
  | { readonly type: 'auto' };

function heldMask(value: unknown): boolean[] | null {
  return Array.isArray(value) && value.length === YACHT_DICE && value.every((entry) => typeof entry === 'boolean')
    ? [...value as boolean[]] : null;
}

export function parseAction(value: unknown): YachtGameAction | string {
  const action = actionRecord(value);
  if (action?.type === 'auto') return { type: 'auto' };
  if (action?.type === 'score') return isYachtBox(action.box) ? { type: 'score', box: action.box } : 'Invalid box.';
  if (action?.type === 'hold') {
    const held = heldMask(action.held);
    return held ? { type: 'hold', held } : 'Invalid dice.';
  }
  if (action?.type === 'roll') {
    if (action.held === undefined) return { type: 'roll' };
    const held = heldMask(action.held);
    return held ? { type: 'roll', held } : 'Invalid dice.';
  }
  return 'Invalid action.';
}
