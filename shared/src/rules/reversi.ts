// ─── Reversi rules: flips, legal moves, automatic passes, and the disc-count result ───

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const RV_SIZE = 8;
export const RV_CELLS = RV_SIZE * RV_SIZE;

/** Index into the match's two seats: side 0 plays dark and moves first. */
export type RvSide = 0 | 1;

/** A disc's side, or null for an empty cell. */
export type RvCell = RvSide | null;

/** Row-major cells (`row * 8 + col`), row 0 at the top of the drawn board, which is rank 8. */
export type RvDiscs = readonly RvCell[];

const DIRECTIONS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

export const rvOpponent = (side: RvSide): RvSide => (side === 0 ? 1 : 0);

export const rvIndex = (col: number, row: number): number => row * RV_SIZE + col;

/** Board node of a cell index, matching `reversiBoard()` ids. */
export const rvNode = (index: number): NodeId => nodeId(index % RV_SIZE, Math.floor(index / RV_SIZE));

/** Cell index of a board node id, or null when it is not a Reversi cell. */
export function rvCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-7]),([0-7])$/.exec(node);
  return match ? rvIndex(Number(match[1]), Number(match[2])) : null;
}

/** Standard start: d4 and e5 light, e4 and d5 dark (rank 1 at the bottom). */
export function rvInitialDiscs(): RvDiscs {
  const discs: RvCell[] = new Array<RvCell>(RV_CELLS).fill(null);
  discs[rvIndex(3, 4)] = 1;
  discs[rvIndex(4, 3)] = 1;
  discs[rvIndex(4, 4)] = 0;
  discs[rvIndex(3, 3)] = 0;
  return discs;
}

/** Cells `side` would flip by placing at `index`; empty when the cell is taken or flips nothing. */
export function rvFlips(discs: RvDiscs, index: number, side: RvSide): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= RV_CELLS || discs[index] !== null) return [];
  const col = index % RV_SIZE;
  const row = Math.floor(index / RV_SIZE);
  const flips: number[] = [];
  for (const [dc, dr] of DIRECTIONS) {
    const line: number[] = [];
    let c = col + dc;
    let r = row + dr;
    while (c >= 0 && c < RV_SIZE && r >= 0 && r < RV_SIZE && discs[rvIndex(c, r)] === rvOpponent(side)) {
      line.push(rvIndex(c, r));
      c += dc;
      r += dr;
    }
    if (line.length > 0 && c >= 0 && c < RV_SIZE && r >= 0 && r < RV_SIZE && discs[rvIndex(c, r)] === side) {
      flips.push(...line);
    }
  }
  return flips;
}

export function rvLegalMoves(discs: RvDiscs, side: RvSide): number[] {
  const moves: number[] = [];
  for (let index = 0; index < RV_CELLS; index++) {
    if (rvFlips(discs, index, side).length > 0) moves.push(index);
  }
  return moves;
}

export function rvHasMove(discs: RvDiscs, side: RvSide): boolean {
  for (let index = 0; index < RV_CELLS; index++) {
    if (rvFlips(discs, index, side).length > 0) return true;
  }
  return false;
}

/** The board after `side` places at `index`, or null when the move is illegal. */
export function rvPlace(discs: RvDiscs, index: number, side: RvSide): { discs: RvDiscs; flips: number[] } | null {
  const flips = rvFlips(discs, index, side);
  if (flips.length === 0) return null;
  const next = [...discs];
  next[index] = side;
  for (const flipped of flips) next[flipped] = side;
  return { discs: next, flips };
}

/** Disc totals by side. */
export function rvCounts(discs: RvDiscs): [dark: number, light: number] {
  let dark = 0;
  let light = 0;
  for (const cell of discs) {
    if (cell === 0) dark++;
    else if (cell === 1) light++;
  }
  return [dark, light];
}

/**
 * The side to move after `moved` played: the opponent, or `moved` again when the opponent has no legal move
 * (an automatic pass), or null when neither side can move and the game is over.
 */
export function rvNextSide(discs: RvDiscs, moved: RvSide): RvSide | null {
  const opponent = rvOpponent(moved);
  if (rvHasMove(discs, opponent)) return opponent;
  return rvHasMove(discs, moved) ? moved : null;
}

/** Side with more discs, or null for equal counts. */
export function rvLeader(discs: RvDiscs): RvSide | null {
  const [dark, light] = rvCounts(discs);
  return dark === light ? null : dark > light ? 0 : 1;
}

/** Whether the grid is a well-formed 8 × 8 position. */
export function isRvDiscs(value: unknown): value is RvDiscs {
  return Array.isArray(value) && value.length === RV_CELLS && value.every((cell) => cell === null || cell === 0 || cell === 1);
}
