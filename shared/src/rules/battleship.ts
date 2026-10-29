// ─── Battleship rules: fleet placement, shots, and the end of a match ───

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

/** Columns and rows of one sea; columns are lettered A–J from the left, rows numbered 1–10 from the top. */
export const BS_SIZE = 10;
export const BS_CELLS = BS_SIZE * BS_SIZE;

/** The fleet in placement order, largest first (Hasbro classic). */
export const BS_SHIPS = ['carrier', 'battleship', 'cruiser', 'submarine', 'destroyer'] as const;
export type BsShip = typeof BS_SHIPS[number];

export const BS_SHIP_LENGTH: Readonly<Record<BsShip, number>> = {
  carrier: 5, battleship: 4, cruiser: 3, submarine: 3, destroyer: 2,
};

/** Cells the whole fleet occupies. */
export const BS_FLEET_CELLS = BS_SHIPS.reduce((sum, ship) => sum + BS_SHIP_LENGTH[ship], 0);

/** One ship: its bow is the top (vertical) or leftmost (horizontal) cell. */
export interface BsPlacement {
  readonly cell: number;
  readonly vertical: boolean;
}

/** One placement per ship, in `BS_SHIPS` order. */
export type BsFleet = readonly BsPlacement[];

/** Room rules chosen before the match. */
export interface BattleshipOptions {
  /** Ships may not touch, not even at a corner. */
  readonly noTouching: boolean;
  /** A hit or a sinking gives the shooter another shot. */
  readonly hitAgain: boolean;
}

export const DEFAULT_BATTLESHIP_OPTIONS: BattleshipOptions = { noTouching: false, hitAgain: false };

export function isBattleshipOptions(value: unknown): value is BattleshipOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && typeof candidate.noTouching === 'boolean'
    && typeof candidate.hitAgain === 'boolean';
}

/** Shortest placement window; longer room timers give longer windows (base plus reserve). */
export const BS_MIN_PLACE_SECONDS = 60;

export function bsPlaceSeconds(baseSeconds: number, bankSeconds: number): number {
  return Math.max(BS_MIN_PLACE_SECONDS, baseSeconds + bankSeconds);
}

export const bsCol = (cell: number): number => cell % BS_SIZE;
export const bsRow = (cell: number): number => Math.floor(cell / BS_SIZE);
export const bsIndex = (col: number, row: number): number => row * BS_SIZE + col;

export function isBsCell(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BS_CELLS;
}

/** Board node of a cell, matching `battleshipBoard()` ids. */
export const bsNode = (cell: number): NodeId => nodeId(bsCol(cell), bsRow(cell));

/** Cell of a board node id, or null when it is not a cell of the sea. */
export function bsCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-9]),([0-9])$/.exec(node);
  return match ? bsIndex(Number(match[1]), Number(match[2])) : null;
}

/** Coordinate as players call it, e.g. `B7`: column letter, then row number from the top. */
export function bsCellLabel(cell: number): string {
  return `${String.fromCharCode(65 + bsCol(cell))}${bsRow(cell) + 1}`;
}

export function isBsShip(value: unknown): value is BsShip {
  return (BS_SHIPS as readonly unknown[]).includes(value);
}

export function isBsPlacement(value: unknown): value is BsPlacement {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && isBsCell(candidate.cell) && typeof candidate.vertical === 'boolean';
}

/** Cells of a ship placed at `placement`, bow first, or null when it runs off the sea. */
export function bsShipCells(ship: BsShip, placement: BsPlacement): number[] | null {
  const length = BS_SHIP_LENGTH[ship];
  const col = bsCol(placement.cell);
  const row = bsRow(placement.cell);
  if (placement.vertical ? row + length > BS_SIZE : col + length > BS_SIZE) return null;
  return Array.from({ length }, (_, step) => (placement.vertical ? bsIndex(col, row + step) : bsIndex(col + step, row)));
}

/** The up to eight cells around a cell. */
export function bsAround(cell: number): number[] {
  const col = bsCol(cell);
  const row = bsRow(cell);
  const cells: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc;
      const r = row + dr;
      if ((dc !== 0 || dr !== 0) && c >= 0 && c < BS_SIZE && r >= 0 && r < BS_SIZE) cells.push(bsIndex(c, r));
    }
  }
  return cells;
}

/** The four orthogonal neighbours of a cell inside the sea. */
export function bsOrthogonal(cell: number): number[] {
  const col = bsCol(cell);
  const row = bsRow(cell);
  return [[col, row - 1], [col + 1, row], [col, row + 1], [col - 1, row]]
    .filter(([c, r]) => c >= 0 && c < BS_SIZE && r >= 0 && r < BS_SIZE).map(([c, r]) => bsIndex(c, r));
}

export type BsPlacementProblem = 'outside' | 'overlap' | 'touching';

/**
 * Why ship `shipIndex` may not go at `placement` beside the other ships already placed (null entries are not
 * placed yet), or null when it may.
 */
export function bsPlacementProblem(
  fleet: readonly (BsPlacement | null)[], shipIndex: number, placement: BsPlacement, options: BattleshipOptions,
): BsPlacementProblem | null {
  const cells = bsShipCells(BS_SHIPS[shipIndex], placement);
  if (!cells) return 'outside';
  const others = new Set<number>();
  fleet.forEach((other, index) => {
    if (other && index !== shipIndex) for (const cell of bsShipCells(BS_SHIPS[index], other) ?? []) others.add(cell);
  });
  if (cells.some((cell) => others.has(cell))) return 'overlap';
  if (options.noTouching && cells.some((cell) => bsAround(cell).some((near) => others.has(near)))) return 'touching';
  return null;
}

/** Null when the fleet places every ship once, inside the sea, by the room's touching rule. */
export function bsFleetError(fleet: unknown, options: BattleshipOptions): string | null {
  if (!Array.isArray(fleet) || fleet.length !== BS_SHIPS.length || !fleet.every(isBsPlacement)) {
    return 'A fleet places all five ships.';
  }
  const problem = fleet.map((placement, index) => bsPlacementProblem(fleet, index, placement, options)).find(Boolean);
  if (problem === 'outside') return 'Ships stay inside the sea.';
  if (problem === 'overlap') return 'Ships may not overlap.';
  if (problem === 'touching') return 'Ships may not touch in this room.';
  return null;
}

/** Ship index on each cell of the sea, or -1 for open water. */
export function bsFleetGrid(fleet: BsFleet): number[] {
  const grid = new Array<number>(BS_CELLS).fill(-1);
  fleet.forEach((placement, index) => {
    for (const cell of bsShipCells(BS_SHIPS[index], placement) ?? []) grid[cell] = index;
  });
  return grid;
}

/** Pairs of neighbouring cells (corners included) held by different ships: lower is more spread out. */
export function bsContacts(fleet: BsFleet): number {
  const grid = bsFleetGrid(fleet);
  let contacts = 0;
  for (let cell = 0; cell < BS_CELLS; cell++) {
    if (grid[cell] < 0) continue;
    for (const near of bsAround(cell)) if (near > cell && grid[near] >= 0 && grid[near] !== grid[cell]) contacts++;
  }
  return contacts;
}

/** A random legal fleet: every ship tries random spots until one fits, starting over if the sea jams. */
export function bsRandomFleet(random: () => number, options: BattleshipOptions): BsPlacement[] {
  for (;;) {
    const fleet: (BsPlacement | null)[] = BS_SHIPS.map(() => null);
    let placed = true;
    for (let index = 0; index < BS_SHIPS.length && placed; index++) {
      placed = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const placement = { cell: Math.floor(random() * BS_CELLS), vertical: random() < 0.5 };
        if (bsPlacementProblem(fleet, index, placement, options) === null) {
          fleet[index] = placement;
          placed = true;
          break;
        }
      }
    }
    if (placed) return fleet as BsPlacement[];
  }
}

export type BsShotOutcome = 'miss' | 'hit' | 'sunk';

export interface BsShotResult {
  readonly outcome: BsShotOutcome;
  /** The ship that sank, named only when it sank */
  readonly ship?: BsShip;
  /** Cells of the sunk ship, bow first */
  readonly cells?: readonly number[];
}

/**
 * The outcome of a shot at `cell` on a sea already shot at `shots` (which must not contain `cell`): open water
 * is a miss, a ship cell a hit, and the last unhit cell of a ship sinks it.
 */
export function bsResolveShot(fleet: BsFleet, shots: readonly number[], cell: number): BsShotResult {
  const grid = bsFleetGrid(fleet);
  const index = grid[cell];
  if (index < 0) return { outcome: 'miss' };
  const ship = BS_SHIPS[index];
  const cells = bsShipCells(ship, fleet[index])!;
  const struck = new Set([...shots, cell]);
  return cells.every((part) => struck.has(part)) ? { outcome: 'sunk', ship, cells } : { outcome: 'hit' };
}

/** Whether every ship cell of the fleet has been shot. */
export function bsFleetSunk(fleet: BsFleet, shots: readonly number[]): boolean {
  const struck = new Set(shots);
  return fleet.every((placement, index) => bsShipCells(BS_SHIPS[index], placement)!.every((cell) => struck.has(cell)));
}
