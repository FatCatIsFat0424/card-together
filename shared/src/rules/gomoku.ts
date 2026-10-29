// ─── Gomoku rules: five in a row, Renju forbidden moves for black, and the swap opening ───

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const GM_SIZE = 15;
export const GM_CELLS = GM_SIZE * GM_SIZE;

/** Side 0 plays black and moves first; side 1 plays white. */
export type GmSide = 0 | 1;

/** A stone's side, or null for an empty intersection. */
export type GmCell = GmSide | null;

/** Row-major intersections (`row * 15 + col`), row 0 at the top of the drawn board, which is rank 15. */
export type GmStones = readonly GmCell[];

/** Room rules chosen before the match. */
export interface GomokuOptions {
  /** Renju: black may not make an overline, a double four, or a double three; exactly five wins for black. */
  readonly renju: boolean;
  /** Swap opening: the first seat places black, white, black; the second seat then picks a colour. */
  readonly swap: boolean;
}

export const DEFAULT_GOMOKU_OPTIONS: GomokuOptions = { renju: false, swap: false };

export function isGomokuOptions(value: unknown): value is GomokuOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 && typeof candidate.renju === 'boolean' && typeof candidate.swap === 'boolean';
}

/** Stones the first seat places in the swap opening before the second seat chooses. */
export const GM_OPENING_STONES = 3;

/** The four line directions: across, down, and both diagonals. */
export const GM_AXES: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

export const gmOpponent = (side: GmSide): GmSide => (side === 0 ? 1 : 0);

export const gmIndex = (col: number, row: number): number => row * GM_SIZE + col;

/** Board node of an intersection index, matching `gomokuBoard()` ids. */
export const gmNode = (index: number): NodeId => nodeId(index % GM_SIZE, Math.floor(index / GM_SIZE));

/** Intersection index of a board node id, or null when it is not a Gomoku intersection. */
export function gmCell(node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^(\d|1[0-4]),(\d|1[0-4])$/.exec(node);
  return match ? gmIndex(Number(match[1]), Number(match[2])) : null;
}

export function gmInitialStones(): GmCell[] {
  return new Array<GmCell>(GM_CELLS).fill(null);
}

/** Whether the grid is a well-formed 15 × 15 position. */
export function isGmStones(value: unknown): value is GmStones {
  return Array.isArray(value) && value.length === GM_CELLS && value.every((cell) => cell === null || cell === 0 || cell === 1);
}

export function gmStoneCount(stones: GmStones): number {
  let count = 0;
  for (const cell of stones) if (cell !== null) count++;
  return count;
}

const inside = (col: number, row: number): boolean => col >= 0 && col < GM_SIZE && row >= 0 && row < GM_SIZE;

// ─── Opening and turn order ───

export type GmStage = 'placing' | 'choosing' | 'playing';

/** The part of a log entry the flow rules read: a placement has `to`, a side choice has `swap`. */
export interface GmFlowEntry {
  readonly to?: string;
  readonly swap?: boolean;
}

/** Stones placed so far; a side choice is not a stone. */
export function gmPlacements(log: readonly GmFlowEntry[]): number {
  let count = 0;
  for (const entry of log) if (entry.to !== undefined) count++;
  return count;
}

/** Whether the second seat took black (swapped). */
export function gmSwapped(log: readonly GmFlowEntry[]): boolean {
  return log.some((entry) => entry.swap === true);
}

/** `placing`: the first seat lays the opening stones; `choosing`: the second seat picks a colour. */
export function gmStage(options: GomokuOptions, log: readonly GmFlowEntry[]): GmStage {
  if (!options.swap) return 'playing';
  const placed = gmPlacements(log);
  if (placed < GM_OPENING_STONES) return 'placing';
  return placed === GM_OPENING_STONES && !log.some((entry) => entry.swap !== undefined) ? 'choosing' : 'playing';
}

/** Black, white, black, white, ...: the side of the next stone depends only on how many are down. */
export const gmSideOfStone = (placed: number): GmSide => (placed % 2 === 0 ? 0 : 1);

/** The seat playing black: the first seat, unless the second seat swapped. */
export function gmBlackSeat<S>(seats: readonly S[], log: readonly GmFlowEntry[]): S {
  return gmSwapped(log) ? seats[1] : seats[0];
}

/** The seat that must act next, ignoring whether the match is over. */
export function gmSeatToAct<S>(seats: readonly S[], options: GomokuOptions, log: readonly GmFlowEntry[]): S {
  const stage = gmStage(options, log);
  if (stage === 'placing') return seats[0];
  if (stage === 'choosing') return seats[1];
  const black = gmBlackSeat(seats, log);
  return gmSideOfStone(gmPlacements(log)) === 0 ? black : seats[0] === black ? seats[1] : seats[0];
}

// ─── Lines ───

/** Contiguous stones of `side` through `index` along one axis, counting `index` itself as a stone of `side`. */
function runLength(stones: GmStones, index: number, side: GmSide, dx: number, dy: number): number {
  const col = index % GM_SIZE;
  const row = Math.floor(index / GM_SIZE);
  let length = 1;
  for (let c = col + dx, r = row + dy; inside(c, r) && stones[gmIndex(c, r)] === side; c += dx, r += dy) length++;
  for (let c = col - dx, r = row - dy; inside(c, r) && stones[gmIndex(c, r)] === side; c -= dx, r -= dy) length++;
  return length;
}

/** Run lengths through `index` on the four axes, as if `side` held that intersection. */
export function gmRuns(stones: GmStones, index: number, side: GmSide): number[] {
  return GM_AXES.map(([dx, dy]) => runLength(stones, index, side, dx, dy));
}

/** Whether a run of this length wins: any five or more, except that Renju black needs exactly five. */
function winsByLength(length: number, side: GmSide, renju: boolean): boolean {
  return renju && side === 0 ? length === 5 : length >= 5;
}

/** Whether `side` placing (or having placed) at `index` completes a winning line. */
export function gmWins(stones: GmStones, index: number, side: GmSide, renju: boolean): boolean {
  return gmRuns(stones, index, side).some((length) => winsByLength(length, side, renju));
}

/** The intersections of the first winning line through `index`, for highlighting; empty when there is none. */
export function gmWinningLine(stones: GmStones, index: number, side: GmSide, renju: boolean): number[] {
  const col = index % GM_SIZE;
  const row = Math.floor(index / GM_SIZE);
  for (const [dx, dy] of GM_AXES) {
    if (!winsByLength(runLength(stones, index, side, dx, dy), side, renju)) continue;
    const line = [index];
    for (let c = col + dx, r = row + dy; inside(c, r) && stones[gmIndex(c, r)] === side; c += dx, r += dy) line.push(gmIndex(c, r));
    for (let c = col - dx, r = row - dy; inside(c, r) && stones[gmIndex(c, r)] === side; c -= dx, r -= dy) line.unshift(gmIndex(c, r));
    return line;
  }
  return [];
}

// ─── Threat shapes and Renju forbidden moves ───

/** Window reaching five cells beyond the placed stone on each side: enough to judge any four or three. */
const REACH = 5;
const EMPTY = 2;
const WALL = 3;

/** Cell codes along one axis around `index`, offsets -5..5: 0 black, 1 white, 2 empty, 3 off the board. */
function lineAround(stones: GmStones, index: number, dx: number, dy: number): number[] {
  const col = index % GM_SIZE;
  const row = Math.floor(index / GM_SIZE);
  const line: number[] = [];
  for (let k = -REACH; k <= REACH; k++) {
    const c = col + k * dx;
    const r = row + k * dy;
    if (!inside(c, r)) line.push(WALL);
    else {
      const cell = stones[gmIndex(c, r)];
      line.push(cell === null ? EMPTY : cell);
    }
  }
  return line;
}

const at = (line: readonly number[], k: number): number => line[k + REACH];

/** Contiguous cells of `side` through offset `k`, as the start and end offsets. */
function span(line: readonly number[], k: number, side: GmSide): [number, number] {
  let start = k;
  let end = k;
  while (start > -REACH && at(line, start - 1) === side) start--;
  while (end < REACH && at(line, end + 1) === side) end++;
  return [start, end];
}

/**
 * Empty offsets where one more stone of `side` completes a winning line through offset 0. Offset 0 holds the
 * stone just placed; completions that do not use it are older threats and do not count.
 */
function completions(line: readonly number[], side: GmSide, renju: boolean): number[] {
  const found: number[] = [];
  for (let k = -4; k <= 4; k++) {
    if (k === 0 || at(line, k) !== EMPTY) continue;
    const copy = line.slice();
    copy[k + REACH] = side;
    const [start, end] = span(copy, k, side);
    if (start <= 0 && end >= 0 && winsByLength(end - start + 1, side, renju)) found.push(k);
  }
  return found;
}

/** A completed row of exactly four with both ends open and no stone behind them: it wins on either end. */
function isStraightFour(line: readonly number[], k: number, side: GmSide): boolean {
  const [start, end] = span(line, k, side);
  if (end - start + 1 !== 4 || start > 0 || end < 0) return false;
  const open = (end2: number, beyond: number): boolean =>
    Math.abs(end2) <= REACH && at(line, end2) === EMPTY && (Math.abs(beyond) > REACH || at(line, beyond) !== side);
  return open(start - 1, start - 2) && open(end + 1, end + 2);
}

/** Pieces of a move that decide Renju: the lines it completes and the threats it makes. */
export interface GmShape {
  /** A line of exactly five (black in Renju) or five and more (everyone else) */
  readonly five: boolean;
  /** Six or more in a row */
  readonly overline: boolean;
  /** Distinct fours: threats to complete five with the next stone; a straight four counts once */
  readonly fours: number;
  /** Open threes: rows that one more stone turns into a straight four */
  readonly threes: number;
}

/**
 * `side` has just placed `work[index]`. With `restrict` set, a stone that would make a straight four does not
 * make the three open when that stone is itself forbidden for black.
 */
function shapeOf(work: GmCell[], index: number, side: GmSide, renju: boolean, restrict: boolean): GmShape {
  let five = false;
  let overline = false;
  let fours = 0;
  let threes = 0;
  for (const [dx, dy] of GM_AXES) {
    const line = lineAround(work, index, dx, dy);
    const [start, end] = span(line, 0, side);
    const length = end - start + 1;
    if (winsByLength(length, side, renju)) five = true;
    if (renju && side === 0 && length >= 6) overline = true;
    const done = completions(line, side, renju);
    if (done.length > 0) {
      fours += done.length === 2 && Math.abs(done[0] - done[1]) === 5 ? 1 : done.length >= 2 ? 2 : 1;
      continue;
    }
    if (length >= 4) continue;
    let open = false;
    for (let k = -4; k <= 4 && !open; k++) {
      if (k === 0 || at(line, k) !== EMPTY) continue;
      const copy = line.slice();
      copy[k + REACH] = side;
      if (!isStraightFour(copy, k, side)) continue;
      if (restrict) {
        const target = index + k * (dy * GM_SIZE + dx);
        work[target] = side;
        const forbidden = forbiddenPlaced(work, target);
        work[target] = null;
        if (forbidden) continue;
      }
      open = true;
    }
    if (open) threes++;
  }
  return { five, overline, fours, threes };
}

/** Whether black's stone already at `work[index]` breaks a Renju rule; exactly five is always allowed. */
function forbiddenPlaced(work: GmCell[], index: number): boolean {
  const shape = shapeOf(work, index, 0, true, true);
  if (shape.five) return false;
  return shape.overline || shape.fours >= 2 || shape.threes >= 2;
}

/**
 * The threats a stone of `side` at the empty intersection `index` would make. `renju` applies black's
 * exact-five rule and forbids counting a three whose open four black could not legally play.
 */
export function gmShape(stones: GmStones, index: number, side: GmSide, renju: boolean): GmShape {
  const work = [...stones];
  work[index] = side;
  return shapeOf(work, index, side, renju, renju && side === 0);
}

/**
 * Whether black may not play the empty intersection `index` under Renju: an overline, a double four, or a
 * double three, unless the stone makes exactly five. `work` is changed while checking and restored.
 */
export function gmForbiddenInPlace(work: GmCell[], index: number): boolean {
  if (work[index] !== null) return false;
  work[index] = 0;
  const forbidden = forbiddenPlaced(work, index);
  work[index] = null;
  return forbidden;
}

export function gmForbidden(stones: GmStones, index: number): boolean {
  return gmForbiddenInPlace([...stones], index);
}

/** Whether `side` may play `index`: it is empty, and under Renju black avoids the forbidden shapes. */
export function gmIsLegal(stones: GmStones, index: number, side: GmSide, renju: boolean): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= GM_CELLS || stones[index] !== null) return false;
  return !(renju && side === 0 && gmForbidden(stones, index));
}

/** Every intersection `side` may play, in board order. */
export function gmLegalMoves(stones: GmStones, side: GmSide, renju: boolean): number[] {
  const moves: number[] = [];
  const work = renju && side === 0 ? [...stones] : null;
  for (let index = 0; index < GM_CELLS; index++) {
    if (stones[index] !== null) continue;
    if (work && gmForbiddenInPlace(work, index)) continue;
    moves.push(index);
  }
  return moves;
}

/** Whether `side` has any legal intersection left; stops at the first one. */
export function gmHasMove(stones: GmStones, side: GmSide, renju: boolean): boolean {
  const work = renju && side === 0 ? [...stones] : null;
  for (let index = 0; index < GM_CELLS; index++) {
    if (stones[index] === null && !(work && gmForbiddenInPlace(work, index))) return true;
  }
  return false;
}
