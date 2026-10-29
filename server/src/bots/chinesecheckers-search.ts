// ─── Chinese checkers search: progress evaluation with a two-move look-ahead ───
//
// Runs inside a bot worker (`GameBot.search`); its one-move evaluation is also the cheap synchronous move.
// The whole board is public, so the seat's own view is all it reads.

import type { ChineseCheckersVisibleState } from '@shared/types';
import {
  CC_BOARD, CC_HOLES, CC_NEIGHBOURS, CC_TIP_DISTANCE, CC_TRIANGLES, ccIndex, ccNode, ccTarget,
} from '@shared/rules/chinesecheckers';
import { rotatePoint, sideRotation } from '@shared/rules/board/board-model';
import type { SearchContext } from './search/search-types';
import type { BotAction } from './bot-decisions';

/** Marble corners by hole while searching; -1 is empty. */
export type SearchBoard = Int8Array;

export interface SearchMove {
  readonly from: number;
  readonly to: number;
}

const DIRECTIONS = 6;
const EMPTY = -1;
const NEXT = Int16Array.from(CC_NEIGHBOURS.flat());

/** Extra cost per squared row, so a marble left far behind is worth bringing forward first. */
const STRAGGLER_WEIGHT = 0.04;
/** Cost per hole of sideways drift from the line to the target tip, outside the target. */
const DRIFT_WEIGHT = 0.15;
/** A move that finishes the race beats any progress. */
const FINISH_SCORE = 10_000;
/** Undoing one's own previous move is mildly discouraged, so equal moves do not shuttle back and forth. */
const BACKTRACK_COST = 0.6;
/**
 * Weight of the best follow-up move, so two-move plans that set up a jump chain count. Just under 1 keeps
 * immediate progress ahead of an equal plan; 1 or more makes the bot hoard moves instead of playing them.
 */
const FOLLOW_UP_WEIGHT = 0.9;

const IN_TARGET: readonly Uint8Array[] = CC_TRIANGLES.map((_, corner) => {
  const marks = new Uint8Array(CC_HOLES);
  for (const index of CC_TRIANGLES[ccTarget(corner)]) marks[index] = 1;
  return marks;
});

/** Cost of a marble of each corner standing in each hole: lower is closer to home. */
export const SEARCH_COST: readonly Float64Array[] = CC_TRIANGLES.map((_, corner) => {
  const target = ccTarget(corner);
  const turn = sideRotation(CC_BOARD, target);
  return Float64Array.from(CC_BOARD.nodes, (node, index) => {
    const rows = CC_TIP_DISTANCE[target][index];
    const drift = Math.abs(rotatePoint(CC_BOARD, node, turn).x - CC_BOARD.width / 2);
    return rows + STRAGGLER_WEIGHT * rows * rows + (IN_TARGET[corner][index] ? 0 : DRIFT_WEIGHT * drift);
  });
});

export function searchBoard(holes: ChineseCheckersVisibleState['holes']): SearchBoard {
  return Int8Array.from(holes, (hole) => (hole === null ? EMPTY : hole));
}

// Shared visit stamps per hole avoid clearing arrays for every marble: `listed` marks destinations already
// written, `jumped` the landings the jump search has queued (a step target can still continue a chain).
const listed = new Int32Array(CC_HOLES);
const jumped = new Int32Array(CC_HOLES);
let stamp = 0;
const queue = new Int16Array(CC_HOLES);

/** Writes every hole the marble at `from` can reach into `out` from `start`; returns the new end. */
function reach(board: SearchBoard, from: number, out: Int16Array, start: number): number {
  stamp++;
  let end = start;
  for (let direction = 0; direction < DIRECTIONS; direction++) {
    const next = NEXT[from * DIRECTIONS + direction];
    if (next >= 0 && board[next] === EMPTY) {
      listed[next] = stamp;
      out[end++] = next;
    }
  }
  let head = 0;
  let tail = 0;
  queue[tail++] = from;
  jumped[from] = stamp;
  while (head < tail) {
    const at = queue[head++];
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      const over = NEXT[at * DIRECTIONS + direction];
      if (over < 0 || over === from || board[over] === EMPTY) continue;
      const land = NEXT[over * DIRECTIONS + direction];
      if (land < 0 || board[land] !== EMPTY || jumped[land] === stamp) continue;
      jumped[land] = stamp;
      queue[tail++] = land;
      if (listed[land] !== stamp) {
        listed[land] = stamp;
        out[end++] = land;
      }
    }
  }
  return end;
}

const buffer = new Int16Array(CC_HOLES * 10);

/** Every legal move of `corner`, in hole order. */
export function searchMoves(board: SearchBoard, corner: number): SearchMove[] {
  const moves: SearchMove[] = [];
  for (let from = 0; from < CC_HOLES; from++) {
    if (board[from] !== corner) continue;
    const end = reach(board, from, buffer, 0);
    for (let index = 0; index < end; index++) moves.push({ from, to: buffer[index] });
  }
  return moves;
}

/** Same rule as `ccFinished`: the target is full and holds at least one own marble. */
export function searchFinished(board: SearchBoard, corner: number): boolean {
  let own = 0;
  for (const index of CC_TRIANGLES[ccTarget(corner)]) {
    if (board[index] === EMPTY) return false;
    if (board[index] === corner) own++;
  }
  return own > 0;
}

/** Progress a move makes for `corner`; finishing outweighs everything. */
function gain(board: SearchBoard, corner: number, move: SearchMove): number {
  const cost = SEARCH_COST[corner];
  board[move.to] = corner;
  board[move.from] = EMPTY;
  const done = searchFinished(board, corner);
  board[move.from] = corner;
  board[move.to] = EMPTY;
  return cost[move.from] - cost[move.to] + (done ? FINISH_SCORE : 0);
}

/** The largest progress any single move of `corner` makes on this board. */
function bestGain(board: SearchBoard, corner: number): number {
  let best = -Infinity;
  for (const move of searchMoves(board, corner)) best = Math.max(best, gain(board, corner, move));
  return best === -Infinity ? 0 : best;
}

export interface SearchOptions {
  /** The seat's own previous move, to avoid shuttling straight back */
  readonly previous: SearchMove | null;
  /** Corners of the other seats still playing, in turn order after the searcher */
  readonly opponents: readonly number[];
  readonly expired: () => boolean;
  readonly random: () => number;
  /** 1 scores each move alone; 2 adds the best follow-up and, with one opponent, its best reply. */
  readonly depth: 1 | 2;
}

function firstPly(board: SearchBoard, corner: number, move: SearchMove, previous: SearchMove | null): number {
  const back = previous && move.from === previous.to && move.to === previous.from ? BACKTRACK_COST : 0;
  return gain(board, corner, move) - back;
}

/**
 * The best move for `corner`, or null when every marble is blocked. Each move is first scored by its own
 * progress; with depth 2 the moves are then refined best-first, adding most of the best follow-up move and, in a
 * two-player race, subtracting the opponent's best reply, until the budget runs out. Equal scores are chosen
 * between at random.
 */
export function searchBestMove(board: SearchBoard, corner: number, options: SearchOptions): SearchMove | null {
  const moves = searchMoves(board, corner);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  let scored = moves.map((move) => ({ move, score: firstPly(board, corner, move, options.previous) }))
    .sort((a, b) => b.score - a.score);
  if (options.depth === 2 && scored[0].score < FINISH_SCORE) {
    const refined: typeof scored = [];
    const rival = options.opponents.length === 1 ? options.opponents[0] : null;
    for (const entry of scored) {
      if (options.expired() && refined.length > 0) break;
      const { from, to } = entry.move;
      board[to] = corner;
      board[from] = EMPTY;
      const followUp = bestGain(board, corner);
      const reply = rival === null ? 0 : bestGain(board, rival);
      board[from] = corner;
      board[to] = EMPTY;
      refined.push({ move: entry.move, score: entry.score + FOLLOW_UP_WEIGHT * Math.min(followUp, FINISH_SCORE) - reply });
    }
    scored = refined.sort((a, b) => b.score - a.score);
  }
  const top = scored.filter((entry) => entry.score >= scored[0].score - 1e-9);
  return top[Math.floor(options.random() * top.length)].move;
}

/** The searching seat's corner, opponents, and previous move from its view, or null off turn. */
export function searchSetup(visible: ChineseCheckersVisibleState): {
  readonly corner: number; readonly opponents: number[]; readonly previous: SearchMove | null;
} | null {
  const index = visible.seats.indexOf(visible.mySeat);
  if (index < 0 || visible.phase !== 'playing' || visible.currentTurnSeat !== visible.mySeat
    || visible.resigned.includes(visible.mySeat)) return null;
  const opponents: number[] = [];
  for (let step = 1; step < visible.seats.length; step++) {
    const seat = visible.seats[(index + step) % visible.seats.length];
    if (!visible.resigned.includes(seat)) opponents.push(visible.corners[(index + step) % visible.seats.length]);
  }
  const last = [...visible.log].reverse().find((entry) => entry.seat === visible.mySeat && entry.to !== undefined);
  const from = ccIndex(last?.from);
  const to = ccIndex(last?.to);
  return { corner: visible.corners[index], opponents, previous: from !== null && to !== null ? { from, to } : null };
}

export function moveAction(move: SearchMove): BotAction {
  return {
    type: 'game-action',
    request: { gameType: 'chinesecheckers', action: { type: 'move', from: ccNode(move.from), to: ccNode(move.to) } },
  };
}

/** Search strategy for the bot worker pool. */
export function chineseCheckersSearch(visible: ChineseCheckersVisibleState, context: SearchContext): BotAction | null {
  const setup = searchSetup(visible);
  if (!setup) return null;
  const move = searchBestMove(searchBoard(visible.holes), setup.corner, {
    ...setup, expired: context.budget.expired, random: context.random,
    depth: context.budget.maxDepth === 1 ? 1 : 2,
  });
  return move ? moveAction(move) : null;
}
