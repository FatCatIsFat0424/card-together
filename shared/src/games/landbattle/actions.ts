import { LB_PIECES_PER_SIDE, isLbRank, lbCell } from '../../rules/landbattle';
import type { LbRank } from '../../rules/landbattle';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { landBattleDefinition } from './definition';

export type LandBattleGameAction =
  | { type: 'deploy'; layout: LbRank[] }
  | { type: 'move'; from: NodeId; to: NodeId }
  | MatchControlAction;

export function parseAction(value: unknown): LandBattleGameAction | string {
  const control = parseMatchControl(value, landBattleDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'deploy') {
    const layout = action.layout;
    return Array.isArray(layout) && layout.length === LB_PIECES_PER_SIDE && layout.every(isLbRank)
      ? { type: 'deploy', layout: [...layout] } : 'Invalid deployment.';
  }
  if (action?.type === 'move' && lbCell(action.from) !== null && lbCell(action.to) !== null) {
    return { type: 'move', from: action.from as NodeId, to: action.to as NodeId };
  }
  return 'Invalid action.';
}
