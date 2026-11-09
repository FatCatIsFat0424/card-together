import { DM_PIPS } from '../../rules/dominoes';
import { actionRecord } from '../action-validation';
import type { DominoPip, DominoSide, DominoTile } from './types';

export type DominoesAction =
  | { type: 'play'; tile: DominoTile; side?: DominoSide }
  | { type: 'draw' }
  | { type: 'pass' };

const isPip = (value: unknown): value is DominoPip => (DM_PIPS as readonly unknown[]).includes(value);

/** Copies a `[low, high]` pair; the other order names the same tile but is not accepted. */
export function parseTile(value: unknown): DominoTile | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [low, high] = value as unknown[];
  return isPip(low) && isPip(high) && low <= high ? [low, high] : null;
}

export function parseAction(value: unknown): DominoesAction | string {
  const action = actionRecord(value);
  if (action?.type === 'draw') return { type: 'draw' };
  if (action?.type === 'pass') return { type: 'pass' };
  if (action?.type !== 'play') return 'Invalid action.';
  const tile = parseTile(action.tile);
  if (!tile) return 'Invalid tile.';
  const { side } = action;
  if (side !== undefined && side !== 'left' && side !== 'right') return 'Invalid end.';
  return { type: 'play', tile, ...(side !== undefined ? { side } : {}) };
}
