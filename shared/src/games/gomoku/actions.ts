import { gmCell } from '../../rules/gomoku';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { gomokuDefinition } from './definition';

export type GomokuGameAction =
  | { type: 'place'; to: NodeId }
  /** Swap opening: the second seat takes black (`swap`) or stays white. */
  | { type: 'choose-side'; swap: boolean }
  | MatchControlAction;

export function parseAction(value: unknown): GomokuGameAction | string {
  const control = parseMatchControl(value, gomokuDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'place' && gmCell(action.to) !== null) {
    return { type: 'place', to: action.to as NodeId };
  }
  if (action?.type === 'choose-side' && typeof action.swap === 'boolean') {
    return { type: 'choose-side', swap: action.swap };
  }
  return 'Invalid action.';
}
