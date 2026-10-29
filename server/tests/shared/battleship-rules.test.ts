import { describe, expect, it } from 'vitest';
import {
  BS_FLEET_CELLS, BS_SHIPS, DEFAULT_BATTLESHIP_OPTIONS, bsCell, bsCellLabel, bsContacts, bsFleetError, bsFleetGrid,
  bsFleetSunk, bsIndex, bsNode, bsPlaceSeconds, bsPlacementProblem, bsRandomFleet, bsResolveShot, bsShipCells,
  isBattleshipOptions,
} from '@shared/rules/battleship';
import type { BsPlacement } from '@shared/rules/battleship';
import { battleshipBoard } from '@shared/rules/board/boards';
import { inZone } from '@shared/rules/board/board-model';
import { seededRandom } from '../../src/bots/search/seeded-random';

const NO_TOUCH = { ...DEFAULT_BATTLESHIP_OPTIONS, noTouching: true };
/** Carrier A1–E1, battleship A3–D3, cruiser A5–C5, submarine A7–C7, destroyer A9–B9. */
const ROWS: BsPlacement[] = BS_SHIPS.map((_, index) => ({ cell: index * 20, vertical: false }));

describe('Battleship coordinates and board', () => {
  it('names cells by column letter and row number from the top, matching the board nodes', () => {
    expect(bsCellLabel(bsIndex(1, 6))).toBe('B7');
    expect(bsCellLabel(0)).toBe('A1');
    expect(bsCellLabel(99)).toBe('J10');
    expect(bsNode(bsIndex(1, 6))).toBe('1,6');
    expect(bsCell('1,6')).toBe(bsIndex(1, 6));
    expect([bsCell('10,0'), bsCell('a,1'), bsCell(5)]).toEqual([null, null, null]);
    const board = battleshipBoard();
    expect(board.nodes).toHaveLength(100);
    expect(board.nodes.every((node) => inZone(board, node.id, 'water'))).toBe(true);
    expect(board.sideRotations).toEqual([0, 0]);
  });

  it('gives at least a minute to place, more with longer room timers', () => {
    expect(bsPlaceSeconds(10, 20)).toBe(60);
    expect(bsPlaceSeconds(60, 300)).toBe(360);
  });

  it('accepts exactly the two boolean room rules', () => {
    expect(isBattleshipOptions({ noTouching: true, hitAgain: false })).toBe(true);
    expect(isBattleshipOptions({ noTouching: true })).toBe(false);
    expect(isBattleshipOptions({ noTouching: 1, hitAgain: false })).toBe(false);
  });
});

describe('Battleship placement', () => {
  it('lays ships right or down from the bow and refuses ships that leave the sea', () => {
    expect(bsShipCells('destroyer', { cell: bsIndex(8, 0), vertical: false })).toEqual([8, 9]);
    expect(bsShipCells('carrier', { cell: bsIndex(0, 5), vertical: true })).toEqual([50, 60, 70, 80, 90]);
    expect(bsShipCells('carrier', { cell: bsIndex(6, 0), vertical: false })).toBeNull();
    expect(bsShipCells('carrier', { cell: bsIndex(0, 6), vertical: true })).toBeNull();
  });

  it('explains why a placement is refused: outside, overlapping, or touching when the room forbids it', () => {
    const fleet = [ROWS[0], null, null, null, null];
    expect(bsPlacementProblem(fleet, 4, { cell: 9, vertical: false }, DEFAULT_BATTLESHIP_OPTIONS)).toBe('outside');
    expect(bsPlacementProblem(fleet, 4, { cell: 4, vertical: true }, DEFAULT_BATTLESHIP_OPTIONS)).toBe('overlap');
    // Right below the carrier, and diagonally off its stern.
    expect(bsPlacementProblem(fleet, 4, { cell: 10, vertical: false }, DEFAULT_BATTLESHIP_OPTIONS)).toBeNull();
    expect(bsPlacementProblem(fleet, 4, { cell: 10, vertical: false }, NO_TOUCH)).toBe('touching');
    expect(bsPlacementProblem(fleet, 4, { cell: 15, vertical: false }, NO_TOUCH)).toBe('touching');
    expect(bsPlacementProblem(fleet, 4, { cell: 16, vertical: false }, NO_TOUCH)).toBeNull();
    // A ship never conflicts with its own earlier position.
    expect(bsPlacementProblem(fleet, 0, { cell: 1, vertical: false }, NO_TOUCH)).toBeNull();
  });

  it('accepts a complete legal fleet and rejects missing, overlapping, and touching ones', () => {
    expect(bsFleetError(ROWS, NO_TOUCH)).toBeNull();
    expect(bsFleetError(ROWS.slice(0, 4), DEFAULT_BATTLESHIP_OPTIONS)).not.toBeNull();
    expect(bsFleetError([...ROWS.slice(0, 4), { cell: 0, vertical: true }], DEFAULT_BATTLESHIP_OPTIONS)).toBe('Ships may not overlap.');
    const touching = [...ROWS.slice(0, 4), { cell: 10, vertical: false }];
    expect(bsFleetError(touching, DEFAULT_BATTLESHIP_OPTIONS)).toBeNull();
    expect(bsFleetError(touching, NO_TOUCH)).toBe('Ships may not touch in this room.');
    expect(bsFleetError([...ROWS.slice(0, 4), { cell: 99, vertical: false }], DEFAULT_BATTLESHIP_OPTIONS)).toBe('Ships stay inside the sea.');
    expect(bsFleetError([...ROWS.slice(0, 4), { cell: 1.5, vertical: false }], DEFAULT_BATTLESHIP_OPTIONS)).not.toBeNull();
  });

  it('draws random fleets that obey either touching rule', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const options = seed % 2 ? NO_TOUCH : DEFAULT_BATTLESHIP_OPTIONS;
      const fleet = bsRandomFleet(seededRandom(seed), options);
      expect(bsFleetError(fleet, options)).toBeNull();
      expect(bsFleetGrid(fleet).filter((index) => index >= 0)).toHaveLength(BS_FLEET_CELLS);
      if (options.noTouching) expect(bsContacts(fleet)).toBe(0);
    }
  });
});

describe('Battleship shots', () => {
  it('reports a miss, a hit, and the sinking of a named ship with its cells', () => {
    expect(bsResolveShot(ROWS, [], 10)).toEqual({ outcome: 'miss' });
    expect(bsResolveShot(ROWS, [], 80)).toEqual({ outcome: 'hit' });
    expect(bsResolveShot(ROWS, [80], 81)).toEqual({ outcome: 'sunk', ship: 'destroyer', cells: [80, 81] });
  });

  it('knows a fleet is sunk only when every ship cell was shot', () => {
    const all = ROWS.flatMap((placement, index) => bsShipCells(BS_SHIPS[index], placement)!);
    expect(all).toHaveLength(BS_FLEET_CELLS);
    expect(bsFleetSunk(ROWS, all.slice(1))).toBe(false);
    expect(bsFleetSunk(ROWS, [...all, 99])).toBe(true);
  });
});
