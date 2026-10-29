import { xqCell } from '../../rules/xiangqi';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { xiangqiDefinition } from './definition';

export type XiangqiGameAction =
  | { type: 'move'; from: NodeId; to: NodeId }
  | MatchControlAction;

export function parseAction(value: unknown): XiangqiGameAction | string {
  const control = parseMatchControl(value, xiangqiDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'move' && xqCell(action.from) !== null && xqCell(action.to) !== null && action.from !== action.to) {
    return { type: 'move', from: action.from as NodeId, to: action.to as NodeId };
  }
  return 'Invalid action.';
}
