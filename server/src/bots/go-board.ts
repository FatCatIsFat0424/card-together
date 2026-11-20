// ─── Go bot board: a fast mutable board for the search, its playouts, and ladder reading ───
//
// The grid is padded with an edge ring (`(row + 1) * (size + 2) + col + 1`, the layout of `go-ownership.ts`) and
// chains are circular lists with pseudo-liberty sums, so a move costs a few array updates. Every array is typed and
// sized once per board, so copying a board for a playout or a ladder read allocates nothing. Hashes use the shared
// Zobrist keys, so a board's hash matches `goHashOf` for the superko history.

import { GO_ZOBRIST, goCombineHash, goZobristKey } from '@shared/rules/go';
import type { GoHash, GoPosition, GoSize } from '@shared/rules/go';
import { goLayout } from '@shared/rules/go-ownership';
import type { GoLayout } from '@shared/rules/go-ownership';

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const EDGE = 3;
/** A pass, or no move yet, in move fields and sequences. */
export const PASS = -1;

/** Stone colour of the side to move: `BLACK` or `WHITE`. */
export type Colour = 1 | 2;

/** Per-size tables shared by every board of that size. */
export interface BoardGeometry {
  readonly layout: GoLayout;
  readonly size: GoSize;
  readonly width: number;
  readonly cells: number;
  /** Zobrist keys per padded point: `keyLow[colour * cells + point]` (colour 1 or 2). */
  readonly keyLow: Uint32Array;
  readonly keyHigh: Uint32Array;
  /** Distance of each padded point to the nearest edge, 1 on the first line; 0 on the ring. */
  readonly line: Uint8Array;
  /** Scratch marks for liberty and region walks, with the stamp of the current walk. */
  readonly mark: Uint32Array;
  stamp: number;
}

const GEOMETRIES = new Map<GoSize, BoardGeometry>();

export function boardGeometry(size: GoSize): BoardGeometry {
  let geometry = GEOMETRIES.get(size);
  if (geometry) return geometry;
  const layout = goLayout(size);
  const { cells, width, toIndex } = layout;
  const keyLow = new Uint32Array(3 * cells);
  const keyHigh = new Uint32Array(3 * cells);
  const line = new Uint8Array(cells);
  for (let point = 0; point < cells; point++) {
    const index = toIndex[point];
    if (index < 0) continue;
    for (const colour of [BLACK, WHITE]) {
      const key = goZobristKey(colour === BLACK ? 0 : 1, index);
      keyLow[colour * cells + point] = GO_ZOBRIST.low[key];
      keyHigh[colour * cells + point] = GO_ZOBRIST.high[key];
    }
    const col = index % size;
    const row = Math.floor(index / size);
    line[point] = 1 + Math.min(col, row, size - 1 - col, size - 1 - row);
  }
  geometry = { layout, size, width, cells, keyLow, keyHigh, line, mark: new Uint32Array(cells), stamp: 0 };
  GEOMETRIES.set(size, geometry);
  return geometry;
}

/** A fresh stamp for `geometry.mark`; clears the marks when the counter wraps. */
export function nextStamp(geometry: BoardGeometry): number {
  if (geometry.stamp >= 0xfffffff0) {
    geometry.mark.fill(0);
    geometry.stamp = 0;
  }
  return ++geometry.stamp;
}

export interface Board {
  readonly geometry: BoardGeometry;
  /** `EMPTY`, a `Colour`, or `EDGE`. */
  readonly colour: Uint8Array;
  /** Chain representative of each stone; chain data is kept at the representative. */
  readonly head: Int32Array;
  /** Next stone in the chain's circular list. */
  readonly next: Int32Array;
  readonly chainSize: Int32Array;
  /** Pseudo-liberties: (stone, adjacent empty point) pairs, with the sum and the square sum of those points. */
  readonly libCount: Int32Array;
  readonly libSum: Int32Array;
  readonly libSquares: Int32Array;
  /** Empty points in no particular order, and each point's slot in that list. */
  readonly empties: Int32Array;
  readonly emptySlot: Int32Array;
  emptyCount: number;
  toMove: Colour;
  /** Point forbidden by simple ko, or `PASS`. */
  ko: number;
  passes: number;
  moves: number;
  hashLow: number;
  hashHigh: number;
  /** The last two moves, newest first (`PASS` for a pass or none). */
  last: number;
  last2: number;
  /** Stones the last move captured. */
  captured: number;
  /** Representatives of chains that were left in atari, newest last; entries go stale and are checked on use. */
  readonly ataris: Int32Array;
  atariCount: number;
  /** Every integer array above, as views of one buffer, so a copy is a single `set`. */
  readonly data: Int32Array;
}

/** Chains in atari a board remembers for the playouts' captures and escapes. */
const ATARI_SLOTS = 16;

function emptyBoard(geometry: BoardGeometry): Board {
  const { cells } = geometry;
  const data = new Int32Array(8 * cells + ATARI_SLOTS);
  const view = (slot: number): Int32Array => data.subarray(slot * cells, (slot + 1) * cells);
  const board: Board = {
    geometry, colour: new Uint8Array(cells), head: view(0), next: view(1), chainSize: view(2), libCount: view(3),
    libSum: view(4), libSquares: view(5), empties: view(6), emptySlot: view(7),
    emptyCount: 0, toMove: BLACK, ko: PASS, passes: 0, moves: 0, hashLow: 0, hashHigh: 0, last: PASS, last2: PASS,
    captured: 0, ataris: data.subarray(8 * cells), atariCount: 0, data,
  };
  board.emptySlot.fill(-1);
  return board;
}

/** A board set up from a position; `last` and `last2` are padded points or `PASS`. */
export function boardFromPosition(position: GoPosition, last = PASS, last2 = PASS): Board {
  const geometry = boardGeometry(position.size);
  const board = emptyBoard(geometry);
  const { toIndex, toPoint } = geometry.layout;
  for (let point = 0; point < geometry.cells; point++) {
    if (toIndex[point] < 0) {
      board.colour[point] = EDGE;
    } else {
      board.emptySlot[point] = board.emptyCount;
      board.empties[board.emptyCount++] = point;
    }
  }
  position.stones.forEach((cell, index) => {
    if (cell === null) return;
    board.toMove = cell === 0 ? BLACK : WHITE;
    placeStone(board, toPoint[index], false);
  });
  board.toMove = position.toMove === 0 ? BLACK : WHITE;
  board.ko = PASS;
  board.passes = position.passes;
  board.moves = position.moves;
  board.last = last;
  board.last2 = last2;
  board.captured = 0;
  for (const point of toPoint) {
    if (board.colour[point] !== EMPTY && board.head[point] === point && inAtari(board, point)) noteAtari(board, point);
  }
  return board;
}

/** Copies `source` into `target` of the same size without allocating. */
export function copyBoard(source: Board, target: Board): void {
  target.colour.set(source.colour);
  target.data.set(source.data);
  target.atariCount = source.atariCount;
  target.emptyCount = source.emptyCount;
  target.toMove = source.toMove;
  target.ko = source.ko;
  target.passes = source.passes;
  target.moves = source.moves;
  target.hashLow = source.hashLow;
  target.hashHigh = source.hashHigh;
  target.last = source.last;
  target.last2 = source.last2;
  target.captured = source.captured;
}

export function cloneBoard(source: Board): Board {
  const target = emptyBoard(source.geometry);
  copyBoard(source, target);
  return target;
}

export const boardHash = (board: Board): GoHash => goCombineHash(board.hashLow, board.hashHigh);

/** Whether the chain at representative `head` has exactly one liberty. */
export function inAtari(board: Board, head: number): boolean {
  const count = board.libCount[head];
  const sum = board.libSum[head];
  return count > 0 && count * board.libSquares[head] === sum * sum;
}

/** The single liberty of a chain in atari. */
export const atariLiberty = (board: Board, head: number): number => board.libSum[head] / board.libCount[head];

/**
 * Writes up to `max` distinct liberties of the chain at `head` into `out` and returns how many it found (at most
 * `max`): an exact count when the chain has fewer.
 */
export function chainLiberties(board: Board, head: number, max: number, out: Int32Array): number {
  if (inAtari(board, head)) {
    out[0] = atariLiberty(board, head);
    return 1;
  }
  const { colour, next } = board;
  const { geometry } = board;
  const { width, mark } = geometry;
  const stamp = nextStamp(geometry);
  let found = 0;
  let stone = head;
  do {
    for (let k = 0; k < 4; k++) {
      const near = stone + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      if (colour[near] !== EMPTY || mark[near] === stamp) continue;
      mark[near] = stamp;
      out[found++] = near;
      if (found >= max) return found;
    }
    stone = next[stone];
  } while (stone !== head);
  return found;
}

function removeEmpty(board: Board, point: number): void {
  const slot = board.emptySlot[point];
  const last = board.empties[--board.emptyCount];
  board.empties[slot] = last;
  board.emptySlot[last] = slot;
  board.emptySlot[point] = -1;
}

function addEmpty(board: Board, point: number): void {
  board.emptySlot[point] = board.emptyCount;
  board.empties[board.emptyCount++] = point;
}

/** Lifts a captured chain and hands its points back as liberties to the stones around it; returns its size. */
function removeChain(board: Board, head: number): number {
  const { colour, next, libCount, libSum, libSquares } = board;
  const { width, cells, keyLow, keyHigh } = board.geometry;
  const removed = colour[head];
  let stone = head;
  do {
    colour[stone] = EMPTY;
    board.hashLow = (board.hashLow ^ keyLow[removed * cells + stone]) >>> 0;
    board.hashHigh = (board.hashHigh ^ keyHigh[removed * cells + stone]) >>> 0;
    addEmpty(board, stone);
    stone = next[stone];
  } while (stone !== head);
  let size = 0;
  do {
    size++;
    const squares = stone * stone;
    for (let k = 0; k < 4; k++) {
      const around = stone + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      const c = colour[around];
      if (c === EMPTY || c === EDGE) continue;
      const owner = board.head[around];
      libCount[owner]++;
      libSum[owner] += stone;
      libSquares[owner] += squares;
    }
    stone = next[stone];
  } while (stone !== head);
  return size;
}

/** Joins two chains of one colour, relabelling the smaller; returns the new representative. */
function merge(board: Board, first: number, second: number): number {
  const { head, next, chainSize } = board;
  const big = chainSize[first] >= chainSize[second] ? first : second;
  const small = big === first ? second : first;
  let stone = small;
  do {
    head[stone] = big;
    stone = next[stone];
  } while (stone !== small);
  const after = next[big];
  next[big] = next[small];
  next[small] = after;
  chainSize[big] += chainSize[small];
  board.libCount[big] += board.libCount[small];
  board.libSum[big] += board.libSum[small];
  board.libSquares[big] += board.libSquares[small];
  return big;
}

/**
 * Places a stone of the side to move, captures (unless set up from a position, where intermediate chains may lack
 * liberties), merges, and sets the ko point; does not check legality or switch sides.
 */
function placeStone(board: Board, point: number, capture: boolean): void {
  const { colour, head, next, chainSize, libCount, libSum, libSquares } = board;
  const { width, cells, keyLow, keyHigh } = board.geometry;
  const own = board.toMove;
  const other = 3 - own;
  removeEmpty(board, point);
  colour[point] = own;
  board.hashLow = (board.hashLow ^ keyLow[own * cells + point]) >>> 0;
  board.hashHigh = (board.hashHigh ^ keyHigh[own * cells + point]) >>> 0;
  head[point] = point;
  next[point] = point;
  chainSize[point] = 1;
  libCount[point] = 0;
  libSum[point] = 0;
  libSquares[point] = 0;
  const squares = point * point;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    const c = colour[near];
    if (c === EMPTY) {
      libCount[point]++;
      libSum[point] += near;
      libSquares[point] += near * near;
    } else if (c !== EDGE) {
      const owner = head[near];
      libCount[owner]--;
      libSum[owner] -= point;
      libSquares[owner] -= squares;
    }
  }
  let captured = 0;
  let lastCaptured = PASS;
  if (capture) {
    for (let k = 0; k < 4; k++) {
      const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      if (colour[near] === other && libCount[head[near]] === 0) {
        lastCaptured = near;
        captured += removeChain(board, head[near]);
      }
    }
  }
  let chain = point;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    if (colour[near] === own && head[near] !== head[chain]) chain = merge(board, head[near], head[chain]);
  }
  board.ko = captured === 1 && chainSize[chain] === 1 && libCount[chain] === 1 ? lastCaptured : PASS;
  board.captured = captured;
  if (capture) {
    if (inAtari(board, chain)) noteAtari(board, chain);
    for (let k = 0; k < 4; k++) {
      const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      if (colour[near] === other && inAtari(board, head[near])) noteAtari(board, head[near]);
    }
  }
}

/** Remembers a chain left in atari, forgetting the oldest entry when the list is full. */
function noteAtari(board: Board, chain: number): void {
  const { ataris } = board;
  for (let slot = 0; slot < board.atariCount; slot++) if (ataris[slot] === chain) return;
  if (board.atariCount === ATARI_SLOTS) {
    ataris.copyWithin(0, 1);
    board.atariCount--;
  }
  ataris[board.atariCount++] = chain;
}

/** Plays a legal placement for the side to move. */
export function playMove(board: Board, point: number): void {
  placeStone(board, point, true);
  board.toMove = board.toMove === BLACK ? WHITE : BLACK;
  board.passes = 0;
  board.moves++;
  board.last2 = board.last;
  board.last = point;
}

export function playPass(board: Board): void {
  board.toMove = board.toMove === BLACK ? WHITE : BLACK;
  board.ko = PASS;
  board.passes++;
  board.moves++;
  board.last2 = board.last;
  board.last = PASS;
  board.captured = 0;
}

/** Whether `colour` may play `point` (empty, not the simple-ko point, not suicide); superko is not checked. */
export function isLegalFor(board: Board, point: number, colour: Colour): boolean {
  const cells = board.colour;
  if (cells[point] !== EMPTY || point === board.ko) return false;
  const { width } = board.geometry;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    const c = cells[near];
    if (c === EMPTY) return true;
    if (c === EDGE) continue;
    const atari = inAtari(board, board.head[near]);
    if (c === colour ? !atari : atari) return true;
  }
  return false;
}

export const isLegal = (board: Board, point: number): boolean => isLegalFor(board, point, board.toMove);

/**
 * Whether `point` is a single-point eye of `colour`: every neighbour is its stone or the edge, and the diagonals
 * hold at most one opponent stone (none on the edge), so filling it can only hurt.
 */
export function isEye(board: Board, point: number, colour: number): boolean {
  const cells = board.colour;
  if (cells[point] !== EMPTY) return false;
  const { width } = board.geometry;
  for (let k = 0; k < 4; k++) {
    const near = cells[point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width)];
    if (near !== colour && near !== EDGE) return false;
  }
  const other = 3 - colour;
  let opponents = 0;
  let edges = 0;
  for (let k = 0; k < 4; k++) {
    const corner = cells[point + (k === 0 ? -width - 1 : k === 1 ? -width + 1 : k === 2 ? width - 1 : width + 1)];
    if (corner === EDGE) edges++;
    else if (corner === other) opponents++;
  }
  return edges > 0 ? opponents === 0 : opponents <= 1;
}

/**
 * Size of `colour`'s chain after it plays `point` when that leaves the chain with a single liberty and captures
 * nothing (a self-atari); 0 otherwise.
 */
export function selfAtariSize(board: Board, point: number, colour: Colour): number {
  const cells = board.colour;
  const { head, next } = board;
  const { width } = board.geometry;
  const other = 3 - colour;
  let liberty = PASS;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    const c = cells[near];
    if (c === EMPTY) {
      if (liberty !== PASS && liberty !== near) return 0;
      liberty = near;
    } else if (c === other && inAtari(board, head[near])) {
      return 0;
    }
  }
  let size = 1;
  let seen0 = PASS;
  let seen1 = PASS;
  let seen2 = PASS;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    if (cells[near] !== colour) continue;
    const chain = head[near];
    if (chain === seen0 || chain === seen1 || chain === seen2) continue;
    if (seen0 === PASS) seen0 = chain;
    else if (seen1 === PASS) seen1 = chain;
    else seen2 = chain;
    size += board.chainSize[chain];
    if (inAtari(board, chain)) continue;
    let stone = chain;
    do {
      for (let j = 0; j < 4; j++) {
        const lib = stone + (j === 0 ? -width : j === 1 ? -1 : j === 2 ? 1 : width);
        if (cells[lib] !== EMPTY || lib === point || lib === liberty) continue;
        if (liberty !== PASS) return 0;
        liberty = lib;
      }
      stone = next[stone];
    } while (stone !== chain);
  }
  return liberty !== PASS ? size : 0;
}

/**
 * Area owner of each point at a playout's end, from black's side: a stone's colour, or an empty point whose
 * neighbours are all one colour. Writes 1 (black), -1 (white), or 0 per intersection index into `owner` when given
 * and returns black's area minus white's.
 */
export function playoutBalance(board: Board, owner?: Int8Array): number {
  const cells = board.colour;
  const { width, layout } = board.geometry;
  const { toPoint } = layout;
  let balance = 0;
  for (let index = 0; index < toPoint.length; index++) {
    const point = toPoint[index];
    let value = 0;
    const c = cells[point];
    if (c === BLACK) value = 1;
    else if (c === WHITE) value = -1;
    else {
      const hasBlack = cells[point - width] === BLACK || cells[point - 1] === BLACK || cells[point + 1] === BLACK
        || cells[point + width] === BLACK;
      const hasWhite = cells[point - width] === WHITE || cells[point - 1] === WHITE || cells[point + 1] === WHITE
        || cells[point + width] === WHITE;
      if (hasBlack !== hasWhite) value = hasBlack ? 1 : -1;
    }
    balance += value;
    if (owner) owner[index] = value;
  }
  return balance;
}
