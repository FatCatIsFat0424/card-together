// ─── Go ownership: a fast mutable playout board, Monte Carlo ownership, Benson's unconditional life, dead stones ───
//
// The playout board pads the grid with an edge ring (`(row + 1) * (size + 2) + col + 1`) and tracks chains as
// circular lists with pseudo-liberty sums, so a move costs a few array updates instead of flood fills. It serves
// the server's dead-stone proposal and the bot search; the readable rules in `go.ts` stay authoritative and
// both share the same Zobrist keys, so a playout board's hash matches `goHashOf`.
//
// `goEstimateDead` with the default playouts, measured on Node 24 (one core): about 17 ms on a played-out 9 × 9
// board and 20 ms on 13 × 13 or 19 × 19; the worst case, an empty 19 × 19 board, about 60 ms. That fits the
// 150 ms the server event loop allows, so it runs synchronously.

import { GO_SIZES, GO_ZOBRIST, goChain, goCombineHash, goHashOf, goNeighbours, goZobristKey } from './go';
import type { GoCell, GoHash, GoPosition, GoSide, GoSize, GoStones } from './go';

/** Chains in atari a playout board remembers for its tactical replies. */
const ATARI_SLOTS = 16;

export const EMPTY = 0;
export const EDGE = 3;
/** Stone colours on the playout board: side + 1. */
export type GoColour = 1 | 2;

const colourOf = (side: GoSide): GoColour => (side === 0 ? 1 : 2);

/** Per-size index maps between padded points and `go.ts` intersections. */
export interface GoLayout {
  readonly size: GoSize;
  readonly width: number;
  readonly cells: number;
  /** Padded point → intersection index, or -1 on the edge ring. */
  readonly toIndex: Int32Array;
  /** Intersection index → padded point. */
  readonly toPoint: Int32Array;
  /** Steps to the four orthogonal neighbours, then the four diagonals. */
  readonly steps: Int32Array;
}

const LAYOUTS = new Map<GoSize, GoLayout>(GO_SIZES.map((size) => {
  const width = size + 2;
  const cells = width * width;
  const toIndex = new Int32Array(cells).fill(-1);
  const toPoint = new Int32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const point = (row + 1) * width + col + 1;
      toIndex[point] = row * size + col;
      toPoint[row * size + col] = point;
    }
  }
  const steps = Int32Array.of(-width, -1, 1, width, -width - 1, -width + 1, width - 1, width + 1);
  return [size, { size, width, cells, toIndex, toPoint, steps }];
}));

export const goLayout = (size: GoSize): GoLayout => LAYOUTS.get(size)!;

export interface GoPlayoutBoard {
  readonly layout: GoLayout;
  /** `EMPTY`, a `GoColour`, or `EDGE`. */
  readonly colour: Uint8Array;
  /** Chain representative of each stone; chain data below is kept at the representative. */
  readonly head: Int32Array;
  /** Next stone in the chain's circular list. */
  readonly next: Int32Array;
  readonly chainSize: Int32Array;
  /** Pseudo-liberties: (stone, adjacent empty point) pairs, with the sum and square sum of those points. */
  readonly libCount: Int32Array;
  readonly libSum: Int32Array;
  readonly libSquares: Float64Array;
  /** Empty points in no particular order, and each point's slot in that list. */
  readonly empties: Int32Array;
  readonly emptySlot: Int32Array;
  emptyCount: number;
  toMove: GoColour;
  /** Point forbidden by simple ko, or -1. */
  ko: number;
  /** Representatives of chains that were left in atari, newest last; entries go stale and are checked on use. */
  readonly ataris: Int32Array;
  atariCount: number;
  passes: number;
  moves: number;
  hashLow: number;
  hashHigh: number;
}

/** A playout board set up from a position. */
export function goPlayoutBoard(position: GoPosition): GoPlayoutBoard {
  const layout = goLayout(position.size);
  const { cells, toIndex } = layout;
  const board: GoPlayoutBoard = {
    layout, colour: new Uint8Array(cells), head: new Int32Array(cells), next: new Int32Array(cells),
    chainSize: new Int32Array(cells), libCount: new Int32Array(cells), libSum: new Int32Array(cells),
    libSquares: new Float64Array(cells), empties: new Int32Array(cells), emptySlot: new Int32Array(cells).fill(-1),
    emptyCount: 0, toMove: colourOf(position.toMove), ko: -1, ataris: new Int32Array(ATARI_SLOTS),
    atariCount: 0, passes: position.passes, moves: position.moves, hashLow: 0, hashHigh: 0,
  };
  for (let point = 0; point < cells; point++) {
    if (toIndex[point] < 0) {
      board.colour[point] = EDGE;
    } else {
      board.emptySlot[point] = board.emptyCount;
      board.empties[board.emptyCount++] = point;
    }
  }
  const toMove = board.toMove;
  position.stones.forEach((cell, index) => {
    if (cell === null) return;
    board.toMove = colourOf(cell);
    placeStone(board, layout.toPoint[index], false);
  });
  board.toMove = toMove;
  board.ko = -1;
  board.atariCount = 0;
  for (const point of layout.toPoint) {
    if (board.colour[point] !== EMPTY && board.head[point] === point && goInAtari(board, point)) noteAtari(board, point);
  }
  return board;
}

/** Copies `source` into `target` (same size) without allocating. */
export function goCopyPlayoutBoard(source: GoPlayoutBoard, target: GoPlayoutBoard): void {
  target.colour.set(source.colour);
  target.head.set(source.head);
  target.next.set(source.next);
  target.chainSize.set(source.chainSize);
  target.libCount.set(source.libCount);
  target.libSum.set(source.libSum);
  target.libSquares.set(source.libSquares);
  target.empties.set(source.empties);
  target.emptySlot.set(source.emptySlot);
  target.emptyCount = source.emptyCount;
  target.toMove = source.toMove;
  target.ko = source.ko;
  target.ataris.set(source.ataris);
  target.atariCount = source.atariCount;
  target.passes = source.passes;
  target.moves = source.moves;
  target.hashLow = source.hashLow;
  target.hashHigh = source.hashHigh;
}

export function goClonePlayoutBoard(source: GoPlayoutBoard): GoPlayoutBoard {
  const { layout } = source;
  const target: GoPlayoutBoard = {
    layout, colour: new Uint8Array(layout.cells), head: new Int32Array(layout.cells), next: new Int32Array(layout.cells),
    chainSize: new Int32Array(layout.cells), libCount: new Int32Array(layout.cells), libSum: new Int32Array(layout.cells),
    libSquares: new Float64Array(layout.cells), empties: new Int32Array(layout.cells),
    emptySlot: new Int32Array(layout.cells), emptyCount: 0, toMove: 1, ko: -1,
    ataris: new Int32Array(ATARI_SLOTS), atariCount: 0, passes: 0, moves: 0, hashLow: 0, hashHigh: 0,
  };
  goCopyPlayoutBoard(source, target);
  return target;
}

export const goBoardHash = (board: GoPlayoutBoard): GoHash => goCombineHash(board.hashLow, board.hashHigh);

/** Whether the chain at representative `head` has exactly one liberty (all its pseudo-liberties are one point). */
export function goInAtari(board: GoPlayoutBoard, head: number): boolean {
  const count = board.libCount[head];
  return count > 0 && count * board.libSquares[head] === board.libSum[head] * board.libSum[head];
}

/** The single liberty of a chain in atari. */
export const goAtariLiberty = (board: GoPlayoutBoard, head: number): number => board.libSum[head] / board.libCount[head];

function removeEmpty(board: GoPlayoutBoard, point: number): void {
  const slot = board.emptySlot[point];
  const last = board.empties[--board.emptyCount];
  board.empties[slot] = last;
  board.emptySlot[last] = slot;
  board.emptySlot[point] = -1;
}

function addEmpty(board: GoPlayoutBoard, point: number): void {
  board.emptySlot[point] = board.emptyCount;
  board.empties[board.emptyCount++] = point;
}

function toggleHash(board: GoPlayoutBoard, colour: number, point: number): void {
  const key = goZobristKey(colour === 1 ? 0 : 1, board.layout.toIndex[point]);
  board.hashLow = (board.hashLow ^ GO_ZOBRIST.low[key]) >>> 0;
  board.hashHigh = (board.hashHigh ^ GO_ZOBRIST.high[key]) >>> 0;
}

/** Lifts a captured chain and hands its points back as liberties to the stones around it; returns its size. */
function removeChain(board: GoPlayoutBoard, head: number): number {
  const { colour, next, libCount, libSum, libSquares } = board;
  const { steps } = board.layout;
  const removed = colour[head];
  let stone = head;
  do {
    colour[stone] = EMPTY;
    toggleHash(board, removed, stone);
    addEmpty(board, stone);
    stone = next[stone];
  } while (stone !== head);
  let size = 0;
  do {
    size++;
    const squares = stone * stone;
    for (let k = 0; k < 4; k++) {
      const around = stone + steps[k];
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

/** Joins two chains of one colour, relabelling the smaller. */
function merge(board: GoPlayoutBoard, first: number, second: number): number {
  const { head, next, chainSize } = board;
  const [big, small] = chainSize[first] >= chainSize[second] ? [first, second] : [second, first];
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
 * liberties), and merges; does not check legality or switch sides.
 */
function placeStone(board: GoPlayoutBoard, point: number, capture: boolean): number {
  const { colour, head, next, chainSize, libCount, libSum, libSquares } = board;
  const { steps } = board.layout;
  const own = board.toMove;
  const other = 3 - own;
  removeEmpty(board, point);
  colour[point] = own;
  toggleHash(board, own, point);
  head[point] = point;
  next[point] = point;
  chainSize[point] = 1;
  libCount[point] = 0;
  libSum[point] = 0;
  libSquares[point] = 0;
  const squares = point * point;
  for (let k = 0; k < 4; k++) {
    const near = point + steps[k];
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
  let lastCaptured = -1;
  for (let k = 0; capture && k < 4; k++) {
    const near = point + steps[k];
    if (colour[near] === other && libCount[head[near]] === 0) {
      lastCaptured = near;
      captured += removeChain(board, head[near]);
    }
  }
  let chain = point;
  for (let k = 0; k < 4; k++) {
    const near = point + steps[k];
    if (colour[near] === own && head[near] !== head[chain]) chain = merge(board, head[near], head[chain]);
  }
  board.ko = captured === 1 && chainSize[chain] === 1 && libCount[chain] === 1 ? lastCaptured : -1;
  if (capture) {
    if (goInAtari(board, chain)) noteAtari(board, chain);
    for (let k = 0; k < 4; k++) {
      const near = point + steps[k];
      if (colour[near] === other && goInAtari(board, head[near])) noteAtari(board, head[near]);
    }
  }
  return captured;
}

/** Plays a legal placement for the side to move; returns the number of stones captured. */
export function goBoardPlay(board: GoPlayoutBoard, point: number): number {
  const captured = placeStone(board, point, true);
  board.toMove = board.toMove === 1 ? 2 : 1;
  board.passes = 0;
  board.moves++;
  return captured;
}

export function goBoardPass(board: GoPlayoutBoard): void {
  board.toMove = board.toMove === 1 ? 2 : 1;
  board.ko = -1;
  board.passes++;
  board.moves++;
}

/** Whether the side to move may play `point` (empty, not the simple-ko point, not suicide); superko is not checked. */
export function goBoardLegal(board: GoPlayoutBoard, point: number): boolean {
  const { colour } = board;
  if (colour[point] !== EMPTY || point === board.ko) return false;
  const { steps } = board.layout;
  const own = board.toMove;
  for (let k = 0; k < 4; k++) {
    const c = colour[point + steps[k]];
    if (c === EMPTY) return true;
    if (c === EDGE) continue;
    const inAtari = goInAtari(board, board.head[point + steps[k]]);
    if (c === own ? !inAtari : inAtari) return true;
  }
  return false;
}

/**
 * Whether `point` is a single-point eye of `colour`: every neighbour is its stone or the edge, and the diagonals
 * hold at most one opponent stone (none on the edge), so filling it can only hurt.
 */
export function goBoardIsEye(board: GoPlayoutBoard, point: number, colour: GoColour): boolean {
  const cells = board.colour;
  if (cells[point] !== EMPTY) return false;
  const { steps } = board.layout;
  for (let k = 0; k < 4; k++) {
    const near = cells[point + steps[k]];
    if (near !== colour && near !== EDGE) return false;
  }
  let opponents = 0;
  let edges = 0;
  for (let k = 4; k < 8; k++) {
    const corner = point + steps[k];
    if (cells[corner] === EDGE) edges++;
    else if (cells[corner] === 3 - colour) opponents++;
  }
  return edges > 0 ? opponents === 0 : opponents <= 1;
}

/**
 * Size of the side to move's chain after playing `point` when that leaves it with a single liberty and captures
 * nothing (a self-atari); 0 otherwise.
 */
export function goSelfAtariSize(board: GoPlayoutBoard, point: number): number {
  const { colour, head } = board;
  const { steps } = board.layout;
  const own = board.toMove;
  let liberty = -1;
  for (let k = 0; k < 4; k++) {
    const near = point + steps[k];
    if (colour[near] !== EMPTY) continue;
    if (liberty >= 0 && liberty !== near) return 0;
    liberty = near;
  }
  for (let k = 0; k < 4; k++) {
    const near = point + steps[k];
    if (colour[near] === 3 - own && goInAtari(board, head[near])) return 0;
  }
  let size = 1;
  const seen: number[] = [];
  for (let k = 0; k < 4; k++) {
    const near = point + steps[k];
    if (colour[near] !== own || seen.includes(head[near])) continue;
    const chain = head[near];
    seen.push(chain);
    size += board.chainSize[chain];
    if (goInAtari(board, chain)) continue;
    let stone = chain;
    do {
      for (let j = 0; j < 4; j++) {
        const lib = stone + steps[j];
        if (colour[lib] !== EMPTY || lib === point || lib === liberty) continue;
        if (liberty >= 0) return 0;
        liberty = lib;
      }
      stone = board.next[stone];
    } while (stone !== chain);
  }
  return liberty >= 0 ? size : 0;
}

/** A sensible playout move: legal, not filling one's own eye, not a self-atari of two or more stones. */
export function goPlayoutCandidate(board: GoPlayoutBoard, point: number): boolean {
  return goBoardLegal(board, point) && !goBoardIsEye(board, point, board.toMove) && goSelfAtariSize(board, point) < 2;
}

/** Probability that a playout takes a capture or an escape from atari, when one is known, over a random move. */
const TACTICAL_RATE = 0.9;

/**
 * A tactical reply: capture an opponent chain in atari, else save one of the mover's own chains in atari by
 * extending when that gains liberties. Reads the recent-atari list, dropping entries that no longer apply.
 */
function tacticalReply(board: GoPlayoutBoard): number {
  const { colour, head, ataris } = board;
  const own = board.toMove;
  let kept = 0;
  let escape = -1;
  let capture = -1;
  for (let slot = 0; slot < board.atariCount; slot++) {
    const chain = ataris[slot];
    const c = colour[chain];
    if (c === EMPTY || head[chain] !== chain || !goInAtari(board, chain)) continue;
    ataris[kept++] = chain;
    const liberty = goAtariLiberty(board, chain);
    if (c !== own) {
      if (goBoardLegal(board, liberty)) capture = liberty;
    } else if (goBoardLegal(board, liberty) && goSelfAtariSize(board, liberty) === 0) {
      escape = liberty;
    }
  }
  board.atariCount = kept;
  return capture >= 0 ? capture : escape;
}

/** Remembers a chain left in atari, forgetting the oldest entry when the list is full. */
function noteAtari(board: GoPlayoutBoard, chain: number): void {
  const { ataris } = board;
  for (let slot = 0; slot < board.atariCount; slot++) if (ataris[slot] === chain) return;
  if (board.atariCount === ATARI_SLOTS) {
    ataris.copyWithin(0, 1);
    board.atariCount--;
  }
  ataris[board.atariCount++] = chain;
}

/** The playout policy's move for the side to move, or -1 to pass when no sensible move is left. */
export function goPlayoutMove(board: GoPlayoutBoard, random: () => number): number {
  if (board.atariCount > 0 && random() < TACTICAL_RATE) {
    const reply = tacticalReply(board);
    if (reply >= 0 && !goBoardIsEye(board, reply, board.toMove)) return reply;
  }
  const count = board.emptyCount;
  if (count === 0) return -1;
  const start = Math.floor(random() * count);
  for (let step = 0; step < count; step++) {
    const point = board.empties[(start + step) % count];
    if (goPlayoutCandidate(board, point)) return point;
  }
  return -1;
}

export interface GoPlayoutOptions {
  /** Placements stop after this many more moves. */
  readonly maxMoves: number;
  /** Sees each placement with the colour that made it, before it is played. */
  readonly onMove?: (point: number, colour: GoColour) => void;
}

/**
 * Plays the policy to the end (two passes, or `maxMoves` more moves) and writes the final board's owner of each
 * intersection into `owner` (see `goBoardOwner`).
 */
export function goRunPlayout(board: GoPlayoutBoard, random: () => number, owner: Int8Array, options: GoPlayoutOptions): void {
  const { maxMoves, onMove } = options;
  for (let played = 0; played < maxMoves && board.passes < 2; played++) {
    const move = goPlayoutMove(board, random);
    if (move < 0) {
      goBoardPass(board);
      continue;
    }
    if (onMove) onMove(move, board.toMove);
    goBoardPlay(board, move);
  }
  goBoardOwner(board, owner);
}

/**
 * Area owner of each intersection: a stone's colour, or for an empty region the one colour that borders it.
 * Written into `owner` (1 black, -1 white, 0 neutral), indexed like `go.ts`.
 */
export function goBoardOwner(board: GoPlayoutBoard, owner: Int8Array): void {
  const { colour, layout } = board;
  const { steps, toPoint, toIndex, cells } = layout;
  const seen = new Uint8Array(cells);
  const region = new Int32Array(cells);
  for (let index = 0; index < toPoint.length; index++) {
    const start = toPoint[index];
    const c = colour[start];
    if (c !== EMPTY) {
      owner[index] = c === 1 ? 1 : -1;
      continue;
    }
    if (seen[start]) continue;
    let length = 0;
    let borders = 0;
    region[length++] = start;
    seen[start] = 1;
    for (let at = 0; at < length; at++) {
      for (let k = 0; k < 4; k++) {
        const near = region[at] + steps[k];
        const n = colour[near];
        if (n === EMPTY) {
          if (!seen[near]) {
            seen[near] = 1;
            region[length++] = near;
          }
        } else if (n !== EDGE) {
          borders |= n;
        }
      }
    }
    const value = borders === 1 ? 1 : borders === 2 ? -1 : 0;
    for (let at = 0; at < length; at++) owner[toIndex[region[at]]] = value;
  }
}

/** Black's area minus white's from an owner map, before komi. */
export function goOwnerBalance(owner: Int8Array): number {
  let balance = 0;
  for (const value of owner) balance += value;
  return balance;
}

// ─── Ownership estimate ───

/** Mulberry32, seeded from the position so equal positions give equal estimates. */
function positionRandom(position: GoPosition): () => number {
  let state = (goHashOf(position.stones) ^ (position.moves * 0x9e3779b1)) >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Playouts per estimate, sized to stay well inside the server's synchronous budget. */
export const goDefaultPlayouts = (size: GoSize): number => (size === 9 ? 1000 : size === 13 ? 700 : 500);

export interface GoOwnershipOptions {
  readonly playouts?: number;
  /** Defaults to a generator seeded from the position, so the estimate is deterministic. */
  readonly random?: () => number;
}

/**
 * Average owner of each intersection over random playouts, from 1 (always black) to -1 (always white). Half the
 * playouts start with each side, so a finished position is not biased toward the side to move.
 */
export function goOwnership(position: GoPosition, options: GoOwnershipOptions = {}): Float64Array {
  const playouts = options.playouts ?? goDefaultPlayouts(position.size);
  const random = options.random ?? positionRandom(position);
  const start = goPlayoutBoard({ ...position, passes: 0 });
  const board = goClonePlayoutBoard(start);
  const points = position.size * position.size;
  const owner = new Int8Array(points);
  const total = new Float64Array(points);
  for (let run = 0; run < playouts; run++) {
    goCopyPlayoutBoard(start, board);
    board.toMove = run % 2 === 0 ? 1 : 2;
    goRunPlayout(board, random, owner, { maxMoves: points * 3 });
    for (let index = 0; index < points; index++) total[index] += owner[index];
  }
  if (playouts > 0) for (let index = 0; index < points; index++) total[index] /= playouts;
  return total;
}

// ─── Benson's unconditional life ───

/**
 * Stones that cannot be captured even if the opponent plays every move (Benson's algorithm): chains with two
 * regions all of whose empty points are their liberties, where every chain around those regions qualifies too.
 */
export function goUnconditionallyAlive(size: GoSize, stones: GoStones): boolean[] {
  const alive = new Array<boolean>(stones.length).fill(false);
  for (const side of [0, 1] as const) {
    const chainOf = new Int32Array(stones.length).fill(-1);
    const chains: number[][] = [];
    for (let point = 0; point < stones.length; point++) {
      if (stones[point] !== side || chainOf[point] >= 0) continue;
      const chain = goChain(size, stones, point);
      for (const stone of chain) chainOf[stone] = chains.length;
      chains.push(chain);
    }
    // Regions: maximal connected sets of points without this side's stones, with the chains around them and
    // whether each chain touches every empty point of the region.
    interface Region { readonly around: Set<number>; readonly vitalTo: Set<number> }
    const regions: Region[] = [];
    const seen = new Uint8Array(stones.length);
    for (let start = 0; start < stones.length; start++) {
      if (stones[start] === side || seen[start]) continue;
      const points = [start];
      seen[start] = 1;
      const around = new Set<number>();
      for (let at = 0; at < points.length; at++) {
        for (const near of goNeighbours(size, points[at])) {
          if (stones[near] === side) around.add(chainOf[near]);
          else if (!seen[near]) {
            seen[near] = 1;
            points.push(near);
          }
        }
      }
      const vitalTo = new Set<number>();
      for (const chain of around) {
        const touchesAll = points.every((point) => stones[point] !== null
          || goNeighbours(size, point).some((near) => chainOf[near] === chain));
        if (touchesAll) vitalTo.add(chain);
      }
      regions.push({ around, vitalTo });
    }
    const living = new Set(chains.map((_, id) => id));
    const healthy = new Set(regions.map((_, id) => id));
    for (let changed = true; changed;) {
      changed = false;
      for (const chain of [...living]) {
        let vital = 0;
        for (const id of healthy) if (regions[id].vitalTo.has(chain)) vital++;
        if (vital < 2) {
          living.delete(chain);
          changed = true;
        }
      }
      for (const id of [...healthy]) {
        if ([...regions[id].around].some((chain) => !living.has(chain))) {
          healthy.delete(id);
          changed = true;
        }
      }
    }
    for (const chain of living) for (const stone of chains[chain]) alive[stone] = true;
  }
  return alive;
}

// ─── Dead stones ───

/** A chain is dead when the opponent owns its points in at least this share of the playouts. */
export const GO_DEAD_SHARE = 0.7;

/** Own ownership at or below which a chain counts as dead (the opponent owns it in `GO_DEAD_SHARE` of playouts). */
const DEAD_BALANCE = 1 - 2 * GO_DEAD_SHARE;

/**
 * Each chain's average ownership from its own side's point of view (1 surely its own, -1 surely the
 * opponent's), with unconditionally alive chains forced to 1. Indexed by stone; empty points hold 0.
 */
export function goChainSafety(position: GoPosition, ownership: Float64Array): Float64Array {
  const { size, stones } = position;
  const alive = goUnconditionallyAlive(size, stones);
  const safety = new Float64Array(stones.length);
  const done = new Uint8Array(stones.length);
  for (let point = 0; point < stones.length; point++) {
    const side = stones[point];
    if (side === null || done[point]) continue;
    const chain = goChain(size, stones, point);
    let sum = 0;
    for (const stone of chain) {
      done[stone] = 1;
      sum += ownership[stone];
    }
    const value = alive[point] ? 1 : (side === 0 ? 1 : -1) * sum / chain.length;
    for (const stone of chain) safety[stone] = value;
  }
  return safety;
}

/**
 * Stones whose chain touches only empty regions that border more of the opponent's stones than its own side's:
 * the shape of a dead group inside settled territory, which light playouts can misjudge when the surrounding walls
 * have no formed eyes. Indexed by point.
 */
export function goEnclosedStones(size: GoSize, stones: GoStones): boolean[] {
  /** Per empty point: the side that dominates its region's border, or null for a balanced one. */
  const regionSide = new Array<GoCell>(stones.length).fill(null);
  const seen = new Uint8Array(stones.length);
  for (let start = 0; start < stones.length; start++) {
    if (stones[start] !== null || seen[start]) continue;
    const region = [start];
    seen[start] = 1;
    const border = [new Set<number>(), new Set<number>()];
    for (let at = 0; at < region.length; at++) {
      for (const near of goNeighbours(size, region[at])) {
        const cell = stones[near];
        if (cell !== null) border[cell].add(near);
        else if (!seen[near]) {
          seen[near] = 1;
          region.push(near);
        }
      }
    }
    const side: GoCell = border[0].size > border[1].size ? 0 : border[1].size > border[0].size ? 1 : null;
    for (const point of region) regionSide[point] = side;
  }
  const enclosed = new Array<boolean>(stones.length).fill(false);
  const done = new Uint8Array(stones.length);
  for (let point = 0; point < stones.length; point++) {
    const side = stones[point];
    if (side === null || done[point]) continue;
    const chain = goChain(size, stones, point);
    for (const stone of chain) done[stone] = 1;
    const liberties = new Set<number>();
    for (const stone of chain) for (const near of goNeighbours(size, stone)) if (stones[near] === null) liberties.add(near);
    const opponent = side === 0 ? 1 : 0;
    if (liberties.size > 0 && [...liberties].every((liberty) => regionSide[liberty] === opponent)) {
      for (const stone of chain) enclosed[stone] = true;
    }
  }
  return enclosed;
}

/** Whether a chain safety value (from `goChainSafety`) means the chain is dead. */
export const goSafetyIsDead = (safety: number): boolean => safety <= DEAD_BALANCE;

/**
 * The scoring proposal. A chain is dead unless unconditionally alive when the opponent owns its points in at least
 * `GO_DEAD_SHARE` of the playouts, or when it is enclosed (`goEnclosedStones`) and the opponent owns it in most
 * playouts. Sorted intersection indices; deterministic for a position unless a `random` is given.
 */
export function goEstimateDead(position: GoPosition, options: GoOwnershipOptions = {}): number[] {
  const safety = goChainSafety(position, goOwnership(position, options));
  const enclosed = goEnclosedStones(position.size, position.stones);
  const dead: number[] = [];
  position.stones.forEach((cell, point) => {
    if (cell === null) return;
    if (goSafetyIsDead(safety[point]) || (enclosed[point] && safety[point] < 0)) dead.push(point);
  });
  return dead;
}
