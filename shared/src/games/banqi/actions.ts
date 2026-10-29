import { bqCell } from '../../rules/banqi';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { banqiDefinition } from './definition';

export type BanqiGameAction =
  | { type: 'flip'; to: NodeId }
  | { type: 'move'; from: NodeId; to: NodeId }
  /** Ends a chain of captures (連吃) and passes the turn */
  | { type: 'stop' }
  | MatchControlAction;

export function parseAction(value: unknown): BanqiGameAction | string {
  const control = parseMatchControl(value, banqiDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  switch (action?.type) {
    case 'flip':
      return bqCell(action.to) !== null ? { type: 'flip', to: action.to as NodeId } : 'Invalid action.';
    case 'move':
      return bqCell(action.from) !== null && bqCell(action.to) !== null
        ? { type: 'move', from: action.from as NodeId, to: action.to as NodeId } : 'Invalid action.';
    case 'stop':
      return { type: 'stop' };
    default:
      return 'Invalid action.';
  }
}
