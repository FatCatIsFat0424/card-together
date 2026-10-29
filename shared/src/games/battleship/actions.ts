import { BS_SHIPS, bsCell, isBsCell } from '../../rules/battleship';
import type { BsPlacement } from '../../rules/battleship';
import { parseMatchControl } from '../../rules/board/match-controls';
import type { MatchControlAction } from '../../rules/board/match-controls';
import type { NodeId } from '../../rules/board/board-model';
import { actionRecord } from '../action-validation';
import { battleshipDefinition } from './definition';

export type BattleshipGameAction =
  /** The whole fleet at once, one placement per ship in `BS_SHIPS` order */
  | { type: 'place-fleet'; fleet: BsPlacement[] }
  | { type: 'fire'; to: NodeId }
  | MatchControlAction;

/** Copies only the placement fields, so unknown keys never reach game state. */
function parsePlacement(value: unknown): BsPlacement | null {
  const placement = actionRecord(value);
  return placement && isBsCell(placement.cell) && typeof placement.vertical === 'boolean'
    ? { cell: placement.cell, vertical: placement.vertical } : null;
}

export function parseAction(value: unknown): BattleshipGameAction | string {
  const control = parseMatchControl(value, battleshipDefinition.matchControls);
  if (control !== null) return control;
  const action = actionRecord(value);
  if (action?.type === 'place-fleet') {
    const fleet = Array.isArray(action.fleet) ? Array.from(action.fleet, parsePlacement) : [];
    return fleet.length === BS_SHIPS.length && fleet.every((entry) => entry !== null)
      ? { type: 'place-fleet', fleet } : 'Invalid fleet.';
  }
  if (action?.type === 'fire' && bsCell(action.to) !== null) return { type: 'fire', to: action.to as NodeId };
  return 'Invalid action.';
}
