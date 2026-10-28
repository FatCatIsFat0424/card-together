import { LD_DECK, LD_MAX_PLAY } from '../../rules/liarsdeck';
import { actionRecord } from '../action-validation';

export type LiarsDeckAction = { type: 'play'; cardIds: readonly number[] } | { type: 'challenge' };

export function parseAction(value: unknown): LiarsDeckAction | string {
  const action = actionRecord(value);
  if (action?.type === 'challenge') return { type: 'challenge' };
  if (action?.type !== 'play') return 'Invalid action.';
  const ids = action.cardIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > LD_MAX_PLAY
    || !Array.from(ids).every((id: unknown) => typeof id === 'number' && Number.isInteger(id) && id >= 0 && id < LD_DECK.length)
    || new Set(ids).size !== ids.length) return 'Invalid cards.';
  return { type: 'play', cardIds: [...ids] as number[] };
}
