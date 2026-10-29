import { rvCell } from '../../rules/reversi';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { reversiDefinition } from './definition';

export type ReversiGameAction =
  | { type: 'place'; to: NodeId }
  | MatchControlAction;

export function parseAction(value: unknown): ReversiGameAction | string {
  const control = parseMatchControl(value, reversiDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'place' && rvCell(action.to) !== null) {
    return { type: 'place', to: action.to as NodeId };
  }
  return 'Invalid action.';
}
