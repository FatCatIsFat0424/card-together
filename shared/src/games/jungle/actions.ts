import { jgCell } from '../../rules/jungle';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { jungleDefinition } from './definition';

export type JungleGameAction =
  | { type: 'move'; from: NodeId; to: NodeId }
  | MatchControlAction;

export function parseAction(value: unknown): JungleGameAction | string {
  const control = parseMatchControl(value, jungleDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'move' && jgCell(action.from) !== null && jgCell(action.to) !== null) {
    return { type: 'move', from: action.from as NodeId, to: action.to as NodeId };
  }
  return 'Invalid action.';
}
