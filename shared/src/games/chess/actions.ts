import { CHESS_PROMOTIONS, chessCell } from '../../rules/chess';
import type { ChessPromotion } from '../../rules/chess';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { chessDefinition } from './definition';

export type ChessGameAction =
  | { type: 'move'; from: NodeId; to: NodeId; promotion?: ChessPromotion }
  | MatchControlAction;

export function parseAction(value: unknown): ChessGameAction | string {
  const control = parseMatchControl(value, chessDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type !== 'move' || chessCell(action.from) === null || chessCell(action.to) === null || action.from === action.to) {
    return 'Invalid action.';
  }
  if (action.promotion === undefined) return { type: 'move', from: action.from as NodeId, to: action.to as NodeId };
  if (!(CHESS_PROMOTIONS as readonly unknown[]).includes(action.promotion)) return 'Invalid action.';
  return { type: 'move', from: action.from as NodeId, to: action.to as NodeId, promotion: action.promotion as ChessPromotion };
}
