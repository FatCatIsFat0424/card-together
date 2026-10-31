import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { goDefinition } from './definition';

/** Longest board has 19 × 19 intersections. */
const MAX_POINTS = 361;
const NODE = /^\d{1,2},\d{1,2}$/;

export type GoGameAction =
  | { type: 'place'; to: NodeId }
  | { type: 'pass' }
  /** Marks or unmarks the whole chain at the point as dead (scoring only). */
  | { type: 'toggle-dead'; to: NodeId }
  /** Accepts the dead stones the seat sees; refused when the marking changed since. */
  | { type: 'confirm-score'; dead: number[] }
  /** Abandons the count and plays on (scoring only). */
  | { type: 'resume' }
  | MatchControlAction;

const isNode = (value: unknown): value is NodeId => typeof value === 'string' && NODE.test(value);

export function parseAction(value: unknown): GoGameAction | string {
  const control = parseMatchControl(value, goDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'place' && isNode(action.to)) return { type: 'place', to: action.to };
  if (action?.type === 'toggle-dead' && isNode(action.to)) return { type: 'toggle-dead', to: action.to };
  if (action?.type === 'pass') return { type: 'pass' };
  if (action?.type === 'resume') return { type: 'resume' };
  if (action?.type === 'confirm-score') {
    const { dead } = action;
    return Array.isArray(dead) && dead.length <= MAX_POINTS
      && dead.every((point) => Number.isInteger(point) && point >= 0 && point < MAX_POINTS)
      ? { type: 'confirm-score', dead: [...new Set(dead as number[])].sort((a, b) => a - b) } : 'Invalid dead stones.';
  }
  return 'Invalid action.';
}
