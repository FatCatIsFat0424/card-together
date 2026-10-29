import { ccIndex } from '../../rules/chinesecheckers';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { chineseCheckersDefinition } from './definition';

/** The client names only the marble and its final hole; the server finds the jump chain. */
export type ChineseCheckersAction =
  | { type: 'move'; from: NodeId; to: NodeId }
  | MatchControlAction;

export function parseAction(value: unknown): ChineseCheckersAction | string {
  const control = parseMatchControl(value, chineseCheckersDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'move' && ccIndex(action.from) !== null && ccIndex(action.to) !== null) {
    return { type: 'move', from: action.from as NodeId, to: action.to as NodeId };
  }
  return 'Invalid action.';
}
