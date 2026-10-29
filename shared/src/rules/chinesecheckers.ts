// ─── Chinese checkers rules: corners per player count, steps and jump chains, finishing, and progress ───

import { rotatePoint, sideRotation, zoneNodes } from './board/board-model';
import type { BoardModel, NodeId } from './board/board-model';
import { STAR_CORNERS, starBoard } from './board/boards';

export const CC_BOARD: BoardModel = starBoard();
export const CC_HOLES = CC_BOARD.nodes.length;
export const CC_PIECES = 10;
export const CC_CORNER_COUNT = STAR_CORNERS.length;

/** Occupied seats a match accepts; five players would leave one corner without an opposite player. */
export const CC_PLAYER_COUNTS: readonly number[] = [2, 3, 4, 6];

/**
 * Turns each seat may take before the match is decided by progress. A normal game needs far fewer; the cap
 * stops a game that no longer moves forward.
 */
export const CC_TURN_LIMIT = 150;

/**
 * Home corners (indices into `STAR_CORNERS`) by player count, in play order. Two players face each other,
 * three take alternating triangles (their targets stay empty), four take two opposite pairs, and six fill
 * the star. Increasing indices run clockwise, so play goes clockwise round the board.
 */
const CORNERS_BY_COUNT: Readonly<Partial<Record<number, readonly number[]>>> = {
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  6: [0, 1, 2, 3, 4, 5],
};

/**
 * A hole's marble, named by its owner's home corner, or null when empty. The corner fixes the marble colour
 * and its target, so the board needs no seat names.
 */
export type CcHole = number | null;
export type CcHoles = readonly CcHole[];

/** One legal destination of a marble: a step to a neighbour or the end of a jump chain. */
export interface CcDestination {
  readonly to: number;
  /** Landings between the start and `to` in the shortest jump chain; empty for a step or a single jump. */
  readonly path: readonly number[];
  readonly jump: boolean;
}

export interface CcMove extends CcDestination {
  readonly from: number;
}

/** Home corners of the seats in play order, or null for an unsupported player count. */
export function ccCorners(players: number): readonly number[] | null {
  return CORNERS_BY_COUNT[players] ?? null;
}

/** The corner a marble from `corner` must reach: the triangle opposite its home. */
export const ccTarget = (corner: number): number => (corner + CC_CORNER_COUNT / 2) % CC_CORNER_COUNT;

const INDEX: ReadonlyMap<NodeId, number> = new Map(CC_BOARD.nodes.map((node, index) => [node.id, index]));

export const ccNode = (index: number): NodeId => CC_BOARD.nodes[index].id;

/** Hole index of a board node id, or null when it is not a hole of the star. */
export function ccIndex(node: unknown): number | null {
  return typeof node === 'string' ? INDEX.get(node) ?? null : null;
}

/** The six directions in doubled columns; a jump continues in the direction of its first step. */
const DIRECTIONS: readonly (readonly [number, number])[] = [[2, 0], [1, 1], [-1, 1], [-2, 0], [-1, -1], [1, -1]];

/** For each hole, its neighbour in each direction, or -1 off the board. */
export const CC_NEIGHBOURS: readonly (readonly number[])[] = CC_BOARD.nodes.map((node) => DIRECTIONS.map(([dc, dr]) =>
  INDEX.get(`${node.col + dc},${node.row + dr}`) ?? -1));

/** Hole indices of each corner's triangle, in `STAR_CORNERS` order. */
export const CC_TRIANGLES: readonly (readonly number[])[] = STAR_CORNERS.map((_, corner) =>
  zoneNodes(CC_BOARD, 'home', corner).map((id) => INDEX.get(id)!));

const ROW_HEIGHT = Math.sqrt(3) / 2;

/**
 * Rows from each hole to the tip of each corner: 0 at the tip, 3 at the triangle's base, 16 at the opposite
 * tip. Turning corner `k` to the bottom makes this the row count up from the bottom edge.
 */
export const CC_TIP_DISTANCE: readonly (readonly number[])[] = STAR_CORNERS.map((_, corner) => CC_BOARD.nodes.map((node) => {
  const turned = rotatePoint(CC_BOARD, node, sideRotation(CC_BOARD, corner));
  // `+ 0` turns the -0 of rounding a tiny negative into 0.
  return Math.round((CC_BOARD.height - turned.y) / ROW_HEIGHT) + 0;
}));

/** Distance sum of a full triangle (1 + 2 + 3 + 4 holes on rows 0–3): the least ten marbles can have. */
export const CC_HOME_DISTANCE = CC_TRIANGLES[0].reduce((sum, index) => sum + CC_TIP_DISTANCE[0][index], 0);

/** Starting board: each corner in play fills its own triangle. */
export function ccInitialHoles(corners: readonly number[]): CcHole[] {
  const holes: CcHole[] = new Array<CcHole>(CC_HOLES).fill(null);
  for (const corner of corners) for (const index of CC_TRIANGLES[corner]) holes[index] = corner;
  return holes;
}

/**
 * Every hole the marble at `from` can reach this turn: empty neighbours, and the landings of jump chains over
 * any marble into the empty hole straight beyond. The moving marble's own hole counts as empty while it jumps,
 * and a chain never ends where it started. Steps win over chains reaching the same hole; chains are shortest.
 */
export function ccDestinations(holes: CcHoles, from: number): CcDestination[] {
  if (holes[from] === null || holes[from] === undefined) return [];
  const found = new Map<number, CcDestination>();
  for (const next of CC_NEIGHBOURS[from]) {
    if (next >= 0 && holes[next] === null) found.set(next, { to: next, path: [], jump: false });
  }
  const parent = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const over = CC_NEIGHBOURS[at][direction];
      if (over < 0 || over === from || holes[over] === null) continue;
      const land = CC_NEIGHBOURS[over][direction];
      if (land < 0 || land === from || holes[land] !== null || parent.has(land)) continue;
      parent.set(land, at);
      queue.push(land);
      if (found.has(land)) continue;
      const path: number[] = [];
      for (let step = at; step !== from; step = parent.get(step)!) path.unshift(step);
      found.set(land, { to: land, path, jump: true });
    }
  }
  return [...found.values()];
}

/** Every legal move of the marbles from `corner`, in hole order. */
export function ccMoves(holes: CcHoles, corner: number): CcMove[] {
  const moves: CcMove[] = [];
  holes.forEach((hole, from) => {
    if (hole === corner) for (const destination of ccDestinations(holes, from)) moves.push({ from, ...destination });
  });
  return moves;
}

/** Whether a marble of `corner` can move; a fully blocked side passes its turn. */
export function ccHasMove(holes: CcHoles, corner: number): boolean {
  return holes.some((hole, from) => hole === corner && ccDestinations(holes, from).length > 0);
}

/** The legal destination of the marble at `from` ending at `to`, or null when the move is illegal. */
export function ccFindMove(holes: CcHoles, corner: number, from: number, to: number): CcDestination | null {
  if (holes[from] !== corner) return null;
  return ccDestinations(holes, from).find((destination) => destination.to === to) ?? null;
}

/** The board after moving the marble at `from` to `to`; the caller has checked legality. */
export function ccApply(holes: CcHoles, from: number, to: number): CcHole[] {
  const next = [...holes];
  next[to] = next[from];
  next[from] = null;
  return next;
}

/**
 * Whether `corner` has finished: every hole of its target triangle is taken and at least one holds its own
 * marble. Opposing marbles left in the triangle count as arrived (the anti-spoiling rule), so a player cannot
 * block a target by never leaving it.
 */
export function ccFinished(holes: CcHoles, corner: number): boolean {
  let own = 0;
  for (const index of CC_TRIANGLES[ccTarget(corner)]) {
    const hole = holes[index];
    if (hole === null) return false;
    if (hole === corner) own++;
  }
  return own > 0;
}

/**
 * Rows the marbles of `corner` still have to travel: the distance sum to the target tip less that of a full
 * triangle. Zero means every marble is home; standings after the first finisher rank by this, lower first.
 */
export function ccRemaining(holes: CcHoles, corner: number): number {
  const tip = CC_TIP_DISTANCE[ccTarget(corner)];
  let sum = 0;
  holes.forEach((hole, index) => {
    if (hole === corner) sum += tip[index];
  });
  return Math.max(0, sum - CC_HOME_DISTANCE);
}

/** Marbles of `corner` inside its target triangle. */
export function ccArrived(holes: CcHoles, corner: number): number {
  return CC_TRIANGLES[ccTarget(corner)].filter((index) => holes[index] === corner).length;
}

/**
 * Finishing places from the progress left, lower first; equal progress shares a place. `first` seats already
 * hold first place (the finisher), and `out` seats (resigned, earliest first) fill the last places.
 */
export function ccRanks<S extends string>(
  seats: readonly S[], remaining: Readonly<Partial<Record<S, number>>>, first: readonly S[], out: readonly S[],
): Partial<Record<S, number>> {
  const ranks: Partial<Record<S, number>> = {};
  const racing = seats.filter((seat) => !first.includes(seat) && !out.includes(seat));
  for (const seat of first) ranks[seat] = 1;
  for (const seat of racing) {
    const ahead = racing.filter((other) => (remaining[other] ?? 0) < (remaining[seat] ?? 0)).length;
    ranks[seat] = first.length + 1 + ahead;
  }
  out.forEach((seat, order) => {
    ranks[seat] = seats.length - order;
  });
  return ranks;
}

/** Whether the value is a well-formed board: 121 holes, each empty or a corner index. */
export function isCcHoles(value: unknown): value is CcHoles {
  return Array.isArray(value) && value.length === CC_HOLES
    && value.every((hole) => hole === null || (Number.isInteger(hole) && hole >= 0 && hole < CC_CORNER_COUNT));
}
