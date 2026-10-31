// ─── Go rules: captures, suicide, positional superko, handicaps, area scoring, and coordinate notation ───
//
// Points are row-major intersections (`row * size + col`) matching a square `points` board: row 0 is the top of
// the drawn board, so the notation's row number counts from the bottom (`D4` is col 3, row size - 4). These
// functions favour clarity over speed and never mutate their inputs; the playout engine in `go-ownership.ts`
// is the fast mutable counterpart and shares the Zobrist keys below.

import { nodeId } from './board/board-model';
import type { NodeId } from './board/board-model';

export const GO_SIZES = [9, 13, 19] as const;
export type GoSize = typeof GO_SIZES[number];

/** Side 0 plays black, side 1 white. */
export type GoSide = 0 | 1;

/** A stone's side, or null for an empty intersection. */
export type GoCell = GoSide | null;

export type GoStones = readonly GoCell[];

/** An intersection index, or a pass. */
export type GoMove = number | 'pass';

/** Positional superko key of a board: the side to move is not part of it. A safe integer of 52 bits. */
export type GoHash = number;

/** Room rules chosen before the match. */
export interface GoOptions {
  readonly size: GoSize;
  /** 0 (no handicap) or 2 up to `goMaxHandicap(size)` black stones on fixed points; white then moves first. */
  readonly handicap: number;
}

export const DEFAULT_GO_OPTIONS: GoOptions = { size: 9, handicap: 0 };

/** Compensation for moving second; the half point rules out a tie. */
export const GO_KOMI = 7.5;
/** With a handicap black already has extra stones, so white only gets the tie-breaking half point. */
export const GO_HANDICAP_KOMI = 0.5;

export const isGoSize = (value: unknown): value is GoSize => GO_SIZES.includes(value as GoSize);

/** 9 × 9 marks only five star points, so its handicap stops at five; larger boards take up to nine. */
export const goMaxHandicap = (size: GoSize): number => (size === 9 ? 5 : 9);

export function isGoOptions(value: unknown): value is GoOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2 || !isGoSize(candidate.size)) return false;
  const { handicap } = candidate;
  return typeof handicap === 'number' && Number.isInteger(handicap)
    && (handicap === 0 || (handicap >= 2 && handicap <= goMaxHandicap(candidate.size)));
}

export const goOpponent = (side: GoSide): GoSide => (side === 0 ? 1 : 0);

export const goIndex = (size: GoSize, col: number, row: number): number => row * size + col;

/** Board node of an intersection, in the `col,row` ids of a square board. */
export const goNode = (size: GoSize, index: number): NodeId => nodeId(index % size, Math.floor(index / size));

/** Intersection index of a board node id, or null when it is not on this board. */
export function goPointOfNode(size: GoSize, node: unknown): number | null {
  if (typeof node !== 'string') return null;
  const match = /^(\d{1,2}),(\d{1,2})$/.exec(node);
  if (!match) return null;
  const col = Number(match[1]);
  const row = Number(match[2]);
  return col < size && row < size ? goIndex(size, col, row) : null;
}

export function isGoStones(value: unknown, size: GoSize): value is GoStones {
  return Array.isArray(value) && value.length === size * size
    && value.every((cell) => cell === null || cell === 0 || cell === 1);
}

/** The orthogonal neighbours of every point, per board size. */
const NEIGHBOURS = new Map<GoSize, readonly (readonly number[])[]>(GO_SIZES.map((size) => [size,
  Array.from({ length: size * size }, (_, index) => {
    const col = index % size;
    const row = Math.floor(index / size);
    const around: number[] = [];
    if (row > 0) around.push(index - size);
    if (col > 0) around.push(index - 1);
    if (col < size - 1) around.push(index + 1);
    if (row < size - 1) around.push(index + size);
    return around;
  })]));

export const goNeighbours = (size: GoSize, index: number): readonly number[] => NEIGHBOURS.get(size)![index];

// ─── Star points and handicaps ───

/** Distance of the corner star points from the edge: the 3-3 point on 9 × 9, the 4-4 point otherwise. */
const starEdge = (size: GoSize): number => (size === 9 ? 2 : 3);

/** The marked star points (hoshi): corners and centre, plus the side points on 19 × 19. */
export function goStarPoints(size: GoSize): number[] {
  const near = starEdge(size);
  const far = size - 1 - near;
  const mid = (size - 1) / 2;
  const points = [[near, near], [far, near], [near, far], [far, far], [mid, mid]];
  if (size === 19) points.push([near, mid], [far, mid], [mid, near], [mid, far]);
  return points.map(([col, row]) => goIndex(size, col, row)).sort((a, b) => a - b);
}

/**
 * The usual fixed handicap layouts, seen from black at the bottom: two stones on the lower-left and upper-right
 * corners, three adds the lower right, four fills the corners, five adds the centre, six the left and right
 * sides, seven again the centre, eight the top and bottom sides, nine all of them. On 13 × 13 the side points
 * (fourth line) are not marked as star points on most boards but are where the stones conventionally go.
 */
export function goHandicapPoints(size: GoSize, handicap: number): number[] {
  if (handicap < 2 || handicap > goMaxHandicap(size)) return [];
  const near = starEdge(size);
  const far = size - 1 - near;
  const mid = (size - 1) / 2;
  const corners = [[near, far], [far, near], [far, far], [near, near]];
  const centre = [[mid, mid]];
  const leftRight = [[near, mid], [far, mid]];
  const topBottom = [[mid, near], [mid, far]];
  const layouts: Record<number, number[][]> = {
    2: corners.slice(0, 2),
    3: corners.slice(0, 3),
    4: corners,
    5: [...corners, ...centre],
    6: [...corners, ...leftRight],
    7: [...corners, ...leftRight, ...centre],
    8: [...corners, ...leftRight, ...topBottom],
    9: [...corners, ...leftRight, ...topBottom, ...centre],
  };
  return layouts[handicap].map(([col, row]) => goIndex(size, col, row));
}

// ─── Zobrist hashing ───

/** Mulberry32 with a fixed seed: the keys must be identical on every server, client, and worker. */
function keyGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}

const MAX_POINTS = 19 * 19;

/**
 * Two independent keys per side and point (`side * 361 + index`): 32 low bits and 20 high bits, combined into one
 * safe integer by `goHashOf`. The same table serves every board size.
 */
export const GO_ZOBRIST: { readonly low: Uint32Array; readonly high: Uint32Array } = (() => {
  const next = keyGenerator(0x60_5eed);
  const low = new Uint32Array(2 * MAX_POINTS).map(() => next());
  const high = new Uint32Array(2 * MAX_POINTS).map(() => next() & 0xfffff);
  return { low, high };
})();

export const goZobristKey = (side: GoSide, index: number): number => side * MAX_POINTS + index;

export const goCombineHash = (low: number, high: number): GoHash => (high >>> 0) * 0x1_0000_0000 + (low >>> 0);

export function goHashOf(stones: GoStones): GoHash {
  let low = 0;
  let high = 0;
  stones.forEach((cell, index) => {
    if (cell === null) return;
    const key = goZobristKey(cell, index);
    low ^= GO_ZOBRIST.low[key];
    high ^= GO_ZOBRIST.high[key];
  });
  return goCombineHash(low, high);
}

// ─── Chains ───

/** The chain of connected same-coloured stones through `index` (empty when the point is empty). */
export function goChain(size: GoSize, stones: GoStones, index: number): number[] {
  const colour = stones[index];
  if (colour === null) return [];
  const chain = [index];
  const seen = new Set(chain);
  for (let at = 0; at < chain.length; at++) {
    for (const next of goNeighbours(size, chain[at])) {
      if (!seen.has(next) && stones[next] === colour) {
        seen.add(next);
        chain.push(next);
      }
    }
  }
  return chain;
}

/** Distinct empty points next to a chain. */
export function goLiberties(size: GoSize, stones: GoStones, chain: readonly number[]): number[] {
  const liberties = new Set<number>();
  for (const stone of chain) {
    for (const next of goNeighbours(size, stone)) if (stones[next] === null) liberties.add(next);
  }
  return [...liberties];
}

// ─── Positions and moves ───

export interface GoPosition {
  readonly size: GoSize;
  readonly stones: GoStones;
  readonly toMove: GoSide;
  readonly komi: number;
  /** Opponent stones each side has captured. */
  readonly captures: readonly [number, number];
  /** Consecutive passes just played; two end the play. */
  readonly passes: number;
  /** Moves played so far, passes included (handicap stones are not moves). */
  readonly moves: number;
}

/** The opening position: handicap stones down, white to move when there are any. */
export function goInitialPosition(options: GoOptions): GoPosition {
  const stones = new Array<GoCell>(options.size * options.size).fill(null);
  const handicap = goHandicapPoints(options.size, options.handicap);
  for (const point of handicap) stones[point] = 0;
  return {
    size: options.size, stones, toMove: handicap.length > 0 ? 1 : 0,
    komi: handicap.length > 0 ? GO_HANDICAP_KOMI : GO_KOMI, captures: [0, 0], passes: 0, moves: 0,
  };
}

/** Play stops after this many moves, passes included, and goes straight to scoring. */
export const goMoveLimit = (size: GoSize): number => size * size * 3;

export type GoPlayEnd = 'passes' | 'move-limit';

/** Why play is over, or null while it goes on. */
export function goPlayEnd(position: GoPosition): GoPlayEnd | null {
  if (position.passes >= 2) return 'passes';
  return position.moves >= goMoveLimit(position.size) ? 'move-limit' : null;
}

export type GoMoveError = 'outside' | 'occupied' | 'suicide' | 'superko' | 'over';

/** The board after the side to move places a stone at `point`, before the superko check. */
function placeStone(position: GoPosition, point: number): { stones: GoCell[]; captured: number[] } {
  const { size, toMove } = position;
  const stones = [...position.stones];
  stones[point] = toMove;
  const captured: number[] = [];
  for (const next of goNeighbours(size, point)) {
    if (stones[next] !== goOpponent(toMove)) continue;
    const chain = goChain(size, stones, next);
    if (goLiberties(size, stones, chain).length > 0) continue;
    for (const stone of chain) {
      stones[stone] = null;
      captured.push(stone);
    }
  }
  return { stones, captured };
}

/**
 * Why the side to move may not place a stone at `point`, or null when it may. `history` holds the hash of every
 * board seen so far (the current one included): a placement may not recreate any of them.
 */
export function goMoveError(position: GoPosition, point: number, history: readonly GoHash[]): GoMoveError | null {
  if (goPlayEnd(position) !== null) return 'over';
  if (!Number.isInteger(point) || point < 0 || point >= position.stones.length) return 'outside';
  if (position.stones[point] !== null) return 'occupied';
  const { stones, captured } = placeStone(position, point);
  if (captured.length === 0 && goLiberties(position.size, stones, goChain(position.size, stones, point)).length === 0) {
    return 'suicide';
  }
  return history.includes(goHashOf(stones)) ? 'superko' : null;
}

export interface GoPlayResult {
  readonly position: GoPosition;
  /** Hash of the new board, to append to the history (unchanged by a pass). */
  readonly hash: GoHash;
  /** Opponent stones removed by the move. */
  readonly captured: readonly number[];
}

/** Plays a move, or returns null when it is illegal. */
export function goPlay(position: GoPosition, move: GoMove, history: readonly GoHash[]): GoPlayResult | null {
  if (move === 'pass') {
    if (goPlayEnd(position) !== null) return null;
    return {
      position: { ...position, toMove: goOpponent(position.toMove), passes: position.passes + 1, moves: position.moves + 1 },
      hash: goHashOf(position.stones), captured: [],
    };
  }
  if (goMoveError(position, move, history) !== null) return null;
  const { stones, captured } = placeStone(position, move);
  const captures: [number, number] = [position.captures[0], position.captures[1]];
  captures[position.toMove] += captured.length;
  return {
    position: { ...position, stones, toMove: goOpponent(position.toMove), captures, passes: 0, moves: position.moves + 1 },
    hash: goHashOf(stones), captured,
  };
}

/** Every point the side to move may play, in index order. */
export function goLegalPoints(position: GoPosition, history: readonly GoHash[]): number[] {
  const points: number[] = [];
  for (let point = 0; point < position.stones.length; point++) {
    if (position.stones[point] === null && goMoveError(position, point, history) === null) points.push(point);
  }
  return points;
}

export interface GoGame {
  readonly position: GoPosition;
  /** Hash of every board so far, the opening board first. */
  readonly history: readonly GoHash[];
}

export function goStart(options: GoOptions): GoGame {
  const position = goInitialPosition(options);
  return { position, history: [goHashOf(position.stones)] };
}

/** Replays a move list from the opening, or returns null at the first illegal move. */
export function goReplay(options: GoOptions, moves: readonly GoMove[]): GoGame | null {
  const start = goStart(options);
  let { position } = start;
  const history = [...start.history];
  for (const move of moves) {
    const result = goPlay(position, move, history);
    if (!result) return null;
    position = result.position;
    if (move !== 'pass') history.push(result.hash);
  }
  return { position, history };
}

// ─── Scoring ───

export interface GoScore {
  /** Stones left on the board after removing the dead ones, per side. */
  readonly stones: readonly [number, number];
  /** Empty points (dead stones' points included) bordered only by one side. */
  readonly territory: readonly [number, number];
  /** Stones plus territory, per side. */
  readonly area: readonly [number, number];
  readonly komi: number;
  readonly winner: GoSide;
  /** Points between the winner's total and the loser's, komi included. */
  readonly margin: number;
  /** Who each point counts for: a living stone's side, a territory's owner, or null for a neutral point (dame). */
  readonly owner: readonly GoCell[];
}

/** Chinese area scoring: dead stones are lifted, then each side counts its stones and the empty regions it alone borders. */
export function goScore(size: GoSize, stones: GoStones, dead: readonly number[], komi: number): GoScore {
  const deadSet = new Set(dead);
  const board = stones.map((cell, index) => (deadSet.has(index) ? null : cell));
  const owner: GoCell[] = [...board];
  const area: [number, number] = [0, 0];
  const counted: [number, number] = [0, 0];
  for (const cell of board) if (cell !== null) counted[cell]++;
  const territory: [number, number] = [0, 0];
  const seen = new Uint8Array(board.length);
  for (let start = 0; start < board.length; start++) {
    if (board[start] !== null || seen[start]) continue;
    const region = [start];
    seen[start] = 1;
    const borders = new Set<GoSide>();
    for (let at = 0; at < region.length; at++) {
      for (const next of goNeighbours(size, region[at])) {
        const cell = board[next];
        if (cell !== null) borders.add(cell);
        else if (!seen[next]) {
          seen[next] = 1;
          region.push(next);
        }
      }
    }
    if (borders.size !== 1) continue;
    const side = borders.values().next().value as GoSide;
    territory[side] += region.length;
    for (const point of region) owner[point] = side;
  }
  area[0] = counted[0] + territory[0];
  area[1] = counted[1] + territory[1];
  const difference = area[0] - area[1] - komi;
  return {
    stones: counted, territory, area, komi, winner: difference > 0 ? 0 : 1, margin: Math.abs(difference), owner,
  };
}

/** Marks or unmarks as dead the whole chain at `point`; returns the new sorted dead list. */
export function goToggleDead(size: GoSize, stones: GoStones, dead: readonly number[], point: number): number[] {
  const chain = goChain(size, stones, point);
  if (chain.length === 0) return [...dead].sort((a, b) => a - b);
  const deadSet = new Set(dead);
  const marking = !deadSet.has(point);
  for (const stone of chain) {
    if (marking) deadSet.add(stone);
    else deadSet.delete(stone);
  }
  return [...deadSet].sort((a, b) => a - b);
}

// ─── Notation ───

/** Column letters skip `I`, which reads too much like `J` or a 1. */
export const GO_COLUMNS = 'ABCDEFGHJKLMNOPQRST';

/** `D4`-style name of a point: column letter, then the row counted from the bottom. */
export function goPointName(size: GoSize, index: number): string {
  return `${GO_COLUMNS[index % size]}${size - Math.floor(index / size)}`;
}

/** Point of a `D4`-style name (case-insensitive), or null when it is not on this board. */
export function goParsePoint(size: GoSize, name: string): number | null {
  const match = /^([A-HJ-T])(\d{1,2})$/i.exec(name.trim());
  if (!match) return null;
  const col = GO_COLUMNS.indexOf(match[1].toUpperCase());
  const rank = Number(match[2]);
  if (col < 0 || col >= size || rank < 1 || rank > size) return null;
  return goIndex(size, col, size - rank);
}
