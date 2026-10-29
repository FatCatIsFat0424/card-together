// ─── Pure view helpers for the Battleship table ───

import type { BattleshipShot, BattleshipVisibleState, GameSeat } from '@shared/types';
import {
  BS_CELLS, BS_SHIPS, bsCell, bsCellLabel, bsFleetError, bsNode, bsPlacementProblem, bsShipCells,
} from '@shared/rules/battleship';
import type { BattleshipOptions, BsPlacement, BsPlacementProblem, BsShip, BsShotOutcome } from '@shared/rules/battleship';
import type { NodeId } from '@shared/rules/board/board-model';
import type { Translate } from '../client-game';

/** The other seat of the match, or null when `seat` does not play. */
export function battleshipOpponent(game: Pick<BattleshipVisibleState, 'seats'>, seat: GameSeat): GameSeat | null {
  return game.seats.includes(seat) ? game.seats.find((other) => other !== seat) ?? null : null;
}

/** A shot drawn on the sea it landed in. */
export interface SeaShot {
  readonly cell: number;
  readonly result: BsShotOutcome;
}

/** A ship drawn on a sea: the owner's fleet, a revealed fleet, or an enemy ship that sank. */
export interface SeaShip {
  readonly ship: BsShip;
  readonly placement: BsPlacement;
  readonly sunk: boolean;
}

/** What one sea shows: the shots fired at it, and the ships its viewer may see. */
export interface SeaView {
  readonly shots: readonly SeaShot[];
  readonly ships: readonly SeaShip[];
  /** The newest shot at this sea */
  readonly last: number | null;
}

/** The placement of a ship from its cells in the order the log lists them, bow first. */
function placementOf(cells: readonly NodeId[]): BsPlacement {
  const [bow, next] = cells.map((node) => bsCell(node)!);
  return { cell: bow, vertical: next - bow === 10 };
}

/**
 * The sea of `owner` as everyone may see it: the opponent's shots and their results, the owner's fleet when the
 * view carries it, and otherwise each ship that sank (its cells are public once sunk).
 */
export function seaView(game: BattleshipVisibleState, owner: GameSeat): SeaView {
  const shooter = battleshipOpponent(game, owner);
  const entries = game.log.filter((entry) => entry.seat === shooter);
  const shots = entries.map((entry) => ({ cell: bsCell(entry.to)!, result: entry.result }));
  const sunk = new Map(entries.flatMap((entry) => (entry.ship && entry.sunkCells ? [[entry.ship, entry.sunkCells] as const] : [])));
  const fleet = game.fleets[owner];
  const ships: SeaShip[] = fleet
    ? fleet.map((placement, index) => ({ ship: BS_SHIPS[index], placement, sunk: sunk.has(BS_SHIPS[index]) }))
    : [...sunk].map(([ship, cells]) => ({ ship, placement: placementOf(cells), sunk: true }));
  return { shots, ships, last: shots.at(-1)?.cell ?? null };
}

/** Ships of `owner` still afloat, from the public sinkings. */
export function shipsAfloat(game: BattleshipVisibleState, owner: GameSeat): number {
  const shooter = battleshipOpponent(game, owner);
  return BS_SHIPS.length - game.log.filter((entry) => entry.seat === shooter && entry.result === 'sunk').length;
}

/** Cells of the opponent's sea the viewer may shoot: none unless it is the viewer's turn. */
export function fireTargets(game: BattleshipVisibleState, mySeat: GameSeat | null): NodeId[] {
  if (mySeat === null || game.phase !== 'playing' || game.currentTurnSeat !== mySeat) return [];
  const shot = new Set(game.log.filter((entry) => entry.seat === mySeat).map((entry) => entry.to));
  return Array.from({ length: BS_CELLS }, (_, cell) => bsNode(cell)).filter((node) => !shot.has(node));
}

/** One shot for the move list and status line: 「B7 命中」, 「B7 擊沉 驅逐艦」. */
export function shotText(entry: Pick<BattleshipShot, 'to' | 'result' | 'ship'>, t: Translate): string {
  const cell = bsCellLabel(bsCell(entry.to) ?? 0);
  return entry.ship
    ? t('battleship.shot.sunk', { cell, ship: t(`battleship.ship.${entry.ship}`) })
    : t(entry.result === 'hit' ? 'battleship.shot.hit' : 'battleship.shot.miss', { cell });
}

/** A fleet being placed: one entry per ship in `BS_SHIPS` order, null until the ship is on the sea. */
export type DraftFleet = readonly (BsPlacement | null)[];

export const EMPTY_DRAFT: DraftFleet = BS_SHIPS.map(() => null);

/** Ship index on each cell of a draft, or -1. */
export function draftGrid(draft: DraftFleet): number[] {
  const grid = new Array<number>(BS_CELLS).fill(-1);
  draft.forEach((placement, index) => {
    if (placement) for (const cell of bsShipCells(BS_SHIPS[index], placement) ?? []) grid[cell] = index;
  });
  return grid;
}

/** The draft with ship `index` placed at `placement`, or the reason it cannot go there. */
export function placeDraftShip(
  draft: DraftFleet, index: number, placement: BsPlacement, options: BattleshipOptions,
): DraftFleet | BsPlacementProblem {
  const problem = bsPlacementProblem(draft, index, placement, options);
  return problem ?? draft.map((entry, other) => (other === index ? placement : entry));
}

/** The first ship after `index` (wrapping round) that is not placed yet, or null when all are. */
export function nextUnplaced(draft: DraftFleet, index: number): number | null {
  for (let step = 1; step <= BS_SHIPS.length; step++) {
    const candidate = (index + step) % BS_SHIPS.length;
    if (!draft[candidate]) return candidate;
  }
  return null;
}

/** The complete fleet of a draft when every ship is placed legally, otherwise null. */
export function draftFleet(draft: DraftFleet, options: BattleshipOptions): BsPlacement[] | null {
  if (draft.some((entry) => entry === null)) return null;
  const fleet = draft as BsPlacement[];
  return bsFleetError(fleet, options) === null ? fleet : null;
}
