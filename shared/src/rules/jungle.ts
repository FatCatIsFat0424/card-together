// ─── Jungle (Dou Shou Qi) rules: ranks, river, traps, dens, jumps, and the end of the game ───

import { inZone, nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';
import { jungleBoard } from './board/boards';
import type { BoardOutcome } from './board/board-result';
import type { GameSeat } from '../types/player';

export const JG_COLS = 7;
export const JG_ROWS = 9;
export const JG_CELLS = JG_COLS * JG_ROWS;

/** Plies without a capture after which the game is a draw. */
export const JG_NO_CAPTURE_LIMIT = 100;

/** Index into the match's two seats: side 0 starts at the bottom (rows 6-8) and moves first. */
export type JgSide = 0 | 1;

/**
 * Animals from the weakest to the strongest; a piece's rank is its index plus one. Rank 0 is never stored: it
 * is what a piece counts for while it stands in a trap of the opponent.
 */
export const JG_ANIMALS = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'] as const;
export type JgAnimal = typeof JG_ANIMALS[number];

export const JG_RAT = 1;
export const JG_TIGER = 6;
export const JG_LION = 7;
export const JG_ELEPHANT = 8;

/**
 * Row-major cells (`row * 7 + col`), row 0 at the top of the board as side 0 sees it. 0 is empty; a piece is
 * its rank (1-8) for side 0 and rank + 8 for side 1. Plain numbers keep the position cheap to copy and let the
 * search use typed arrays with the same rules.
 */
export type JgCells = ArrayLike<number>;

export interface JgMove {
  readonly from: number;
  readonly to: number;
}

export const jgOpponent = (side: JgSide): JgSide => (side === 0 ? 1 : 0);

export const jgPiece = (side: JgSide, rank: number): number => rank + side * 8;
export const jgSideOf = (piece: number): JgSide => (piece > 8 ? 1 : 0);
export const jgRankOf = (piece: number): number => ((piece - 1) % 8) + 1;
export const jgAnimalOf = (piece: number): JgAnimal => JG_ANIMALS[jgRankOf(piece) - 1];

export const jgIndex = (col: number, row: number): number => row * JG_COLS + col;

/** Board node of a cell index, matching `jungleBoard()` ids. */
export const jgNode = (index: number): NodeId => nodeId(index % JG_COLS, Math.floor(index / JG_COLS));

/** Cell index of a board node id, or null when it is not a Jungle cell. */
export function jgCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^([0-6]),([0-8])$/.exec(node);
  return match ? jgIndex(Number(match[1]), Number(match[2])) : null;
}

// Terrain comes from the shared board model, so rules and drawing cannot disagree.
const BOARD = jungleBoard();
const WATER: readonly boolean[] = Array.from({ length: JG_CELLS }, (_, index) => inZone(BOARD, jgNode(index), 'water'));
/** Owner of the trap on a cell, or -1. */
const TRAP: readonly number[] = Array.from({ length: JG_CELLS }, (_, index) =>
  [0, 1].find((owner) => inZone(BOARD, jgNode(index), 'trap', owner)) ?? -1);
const DEN: readonly number[] = Array.from({ length: JG_CELLS }, (_, index) =>
  [0, 1].find((owner) => inZone(BOARD, jgNode(index), 'den', owner)) ?? -1);

export const jgIsWater = (index: number): boolean => WATER[index];

/** The cell of a side's den. */
export const jgDenCell = (side: JgSide): number => DEN.indexOf(side);

/** Whether the cell is a den of the given side. */
export const jgIsDen = (index: number, side: JgSide): boolean => DEN[index] === side;

/** Whether a piece of `side` standing on `index` is in a trap of the opponent, which makes its rank 0. */
export const jgTrapped = (index: number, side: JgSide): boolean => TRAP[index] === jgOpponent(side);

/** Orthogonal neighbours of each cell, in a fixed order. */
const STEPS: readonly (readonly number[])[] = Array.from({ length: JG_CELLS }, (_, index) => {
  const col = index % JG_COLS;
  const row = Math.floor(index / JG_COLS);
  const near: number[] = [];
  if (row > 0) near.push(index - JG_COLS);
  if (col > 0) near.push(index - 1);
  if (col < JG_COLS - 1) near.push(index + 1);
  if (row < JG_ROWS - 1) near.push(index + JG_COLS);
  return near;
});

/** Landing cells of lion and tiger jumps over the river, per starting cell, with the water cells crossed. */
const JUMPS: readonly (readonly { readonly landing: number; readonly over: readonly number[] }[])[] = Array.from(
  { length: JG_CELLS }, (_, index) => {
    if (WATER[index]) return [];
    const col = index % JG_COLS;
    const row = Math.floor(index / JG_COLS);
    const jumps: { landing: number; over: number[] }[] = [];
    for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
      const over: number[] = [];
      let c = col + dc;
      let r = row + dr;
      while (c >= 0 && c < JG_COLS && r >= 0 && r < JG_ROWS && WATER[jgIndex(c, r)]) {
        over.push(jgIndex(c, r));
        c += dc;
        r += dr;
      }
      if (over.length > 0 && c >= 0 && c < JG_COLS && r >= 0 && r < JG_ROWS) jumps.push({ landing: jgIndex(c, r), over });
    }
    return jumps;
  },
);

/**
 * Standard start, point-symmetric: side 1 holds rows 0-2 (lion and tiger in the corners, dog and cat in front
 * of them, then rat, leopard, wolf, and elephant on row 2) and side 0 the mirror image on rows 6-8.
 */
export function jgInitialCells(): number[] {
  const cells = new Array<number>(JG_CELLS).fill(0);
  const layout: readonly (readonly [number, number, number])[] = [
    [0, 0, 7], [6, 0, 6], [1, 1, 3], [5, 1, 2], [0, 2, 1], [2, 2, 5], [4, 2, 4], [6, 2, 8],
  ];
  for (const [col, row, rank] of layout) {
    cells[jgIndex(col, row)] = jgPiece(1, rank);
    cells[jgIndex(JG_COLS - 1 - col, JG_ROWS - 1 - row)] = jgPiece(0, rank);
  }
  return cells;
}

/**
 * Whether the piece on `from` may capture the piece on `to`:
 * - a trapped piece counts as rank 0, so anything captures it, the elephant even a trapped rat;
 * - otherwise an equal or lower rank is captured, except that the rat captures the elephant and the elephant
 *   cannot capture the rat;
 * - a rat in the river has no reach onto land and no land piece reaches it: both pieces must be on land, or both
 *   in the water (two rats can fight in the river).
 */
export function jgCanCapture(cells: JgCells, from: number, to: number): boolean {
  const attacker = cells[from];
  const target = cells[to];
  if (attacker === 0 || target === 0) return false;
  const side = jgSideOf(attacker);
  if (jgSideOf(target) === side || WATER[from] !== WATER[to]) return false;
  if (jgTrapped(to, jgOpponent(side))) return true;
  const strength = jgTrapped(from, side) ? 0 : jgRankOf(attacker);
  const defence = jgRankOf(target);
  if (strength === JG_RAT && defence === JG_ELEPHANT) return true;
  if (strength === JG_ELEPHANT && defence === JG_RAT) return false;
  return strength >= defence;
}

/** Cells the piece on `from` may move to, in a fixed order: steps first, then river jumps. */
export function jgTargets(cells: JgCells, from: number): number[] {
  const piece = cells[from];
  if (piece === 0) return [];
  const side = jgSideOf(piece);
  const rank = jgRankOf(piece);
  const targets: number[] = [];
  const reach = (to: number): boolean => {
    if (jgIsDen(to, side)) return false;
    return cells[to] === 0 || jgCanCapture(cells, from, to);
  };
  for (const to of STEPS[from]) {
    if (WATER[to] && rank !== JG_RAT) continue;
    if (reach(to)) targets.push(to);
  }
  if (rank === JG_LION || rank === JG_TIGER) {
    for (const { landing, over } of JUMPS[from]) {
      // Any piece in the water, which can only be a rat of either side, blocks the jump.
      if (over.some((cell) => cells[cell] !== 0)) continue;
      if (reach(landing)) targets.push(landing);
    }
  }
  return targets;
}

export function jgLegalMoves(cells: JgCells, side: JgSide): JgMove[] {
  const moves: JgMove[] = [];
  for (let from = 0; from < JG_CELLS; from++) {
    const piece = cells[from];
    if (piece === 0 || jgSideOf(piece) !== side) continue;
    for (const to of jgTargets(cells, from)) moves.push({ from, to });
  }
  return moves;
}

export function jgHasMove(cells: JgCells, side: JgSide): boolean {
  for (let from = 0; from < JG_CELLS; from++) {
    const piece = cells[from];
    if (piece !== 0 && jgSideOf(piece) === side && jgTargets(cells, from).length > 0) return true;
  }
  return false;
}

/** Whether moving `from` to `to` is legal for the piece standing there. */
export function jgIsLegal(cells: JgCells, from: number, to: number, side: JgSide): boolean {
  const piece = cells[from];
  return piece !== undefined && piece !== 0 && jgSideOf(piece) === side && jgTargets(cells, from).includes(to);
}

/** The position after the move; the caller has checked it is legal. */
export function jgApply(cells: JgCells, move: JgMove): number[] {
  const next = Array.from(cells);
  next[move.to] = next[move.from];
  next[move.from] = 0;
  return next;
}

export function jgPieceCount(cells: JgCells, side: JgSide): number {
  let count = 0;
  for (let index = 0; index < JG_CELLS; index++) {
    if (cells[index] !== 0 && jgSideOf(cells[index]) === side) count++;
  }
  return count;
}

export type JgEnd = 'den-entered' | 'all-captured' | 'no-moves';

/**
 * Whether the game is over after `side` moved to `to`: the mover wins by reaching the den, by leaving the
 * opponent without pieces, or by leaving the opponent without a legal move.
 */
export function jgEnd(cells: JgCells, side: JgSide, to: number): JgEnd | null {
  if (jgIsDen(to, jgOpponent(side))) return 'den-entered';
  const opponent = jgOpponent(side);
  if (jgPieceCount(cells, opponent) === 0) return 'all-captured';
  return jgHasMove(cells, opponent) ? null : 'no-moves';
}

export interface JgOutcome {
  /** The winning side, or null for a draw */
  readonly winner: JgSide | null;
  readonly reason: JgEnd | 'no-capture-limit';
}

/**
 * How the game ends after `side` moved to `to`, or null when it goes on. `quiet` counts the plies since the last
 * capture, this one included.
 */
export function jgOutcome(cells: JgCells, side: JgSide, to: number, quiet: number): JgOutcome | null {
  const end = jgEnd(cells, side, to);
  if (end !== null) return { winner: side, reason: end };
  return quiet >= JG_NO_CAPTURE_LIMIT ? { winner: null, reason: 'no-capture-limit' } : null;
}

/** Plies since the last capture, counting back from the end of the log. */
export function jgQuietPlies(log: readonly { readonly capture: boolean }[]): number {
  let quiet = 0;
  while (quiet < log.length && !log[log.length - 1 - quiet].capture) quiet++;
  return quiet;
}

/** A rule ending as a board outcome for the match's seats in play order. */
export function jgBoardOutcome(outcome: JgOutcome, seats: readonly GameSeat[]): BoardOutcome {
  return { winners: outcome.winner === null ? [] : [seats[outcome.winner]], reason: outcome.reason };
}

/** Whether the cell list is a well-formed position: 63 cells holding nothing or a piece code. */
export function isJgCells(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === JG_CELLS
    && value.every((cell) => Number.isInteger(cell) && cell >= 0 && cell <= 16);
}
