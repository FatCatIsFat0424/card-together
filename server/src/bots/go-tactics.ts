// ─── Go bot tactics: liberties after a move, and ladder reading on scratch boards ───

import {
  EDGE, EMPTY, PASS, chainLiberties, cloneBoard, copyBoard, inAtari, isLegalFor, nextStamp, playMove,
} from './go-board';
import type { Board, Colour } from './go-board';

/**
 * Distinct liberties, up to `max`, of `colour`'s chain after it plays the empty `point`, without playing it. A move
 * that captures counts as `max`: the captured stones free at least one liberty and usually more.
 */
export function libertiesAfter(board: Board, point: number, colour: Colour, max: number): number {
  const cells = board.colour;
  const { head, next } = board;
  const { geometry } = board;
  const { width, mark } = geometry;
  const other = 3 - colour;
  const stamp = nextStamp(geometry);
  mark[point] = stamp;
  let found = 0;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    const c = cells[near];
    if (c === EMPTY) {
      if (mark[near] !== stamp) {
        mark[near] = stamp;
        if (++found >= max) return found;
      }
    } else if (c === other && inAtari(board, head[near])) {
      return max;
    }
  }
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
    let stone = chain;
    do {
      for (let j = 0; j < 4; j++) {
        const lib = stone + (j === 0 ? -width : j === 1 ? -1 : j === 2 ? 1 : width);
        if (cells[lib] !== EMPTY || mark[lib] === stamp) continue;
        mark[lib] = stamp;
        if (++found >= max) return found;
      }
      stone = next[stone];
    } while (stone !== chain);
  }
  return found;
}

/** Ladder reads stop past this depth (stones played) or this many boards, and then count as an escape. */
const LADDER_DEPTH = 80;
const LADDER_NODES = 400;

interface LadderScratch {
  readonly boards: Board[];
  readonly libs: Int32Array;
  readonly rootLibs: Int32Array;
  nodes: number;
}

const SCRATCH = new Map<number, LadderScratch>();

function scratchFor(board: Board): LadderScratch {
  let scratch = SCRATCH.get(board.geometry.size);
  if (!scratch) {
    scratch = { boards: [], libs: new Int32Array(4), rootLibs: new Int32Array(4), nodes: 0 };
    SCRATCH.set(board.geometry.size, scratch);
  }
  return scratch;
}

function scratchBoard(scratch: LadderScratch, depth: number, source: Board): Board {
  while (scratch.boards.length <= depth) scratch.boards.push(cloneBoard(source));
  const board = scratch.boards[depth];
  copyBoard(source, board);
  return board;
}

/**
 * Whether the chain through `stone` can escape when it is in atari and its owner is to move: by capturing an
 * attacker chain next to it, or by extending to three or more liberties, or to two from which the ladder fails.
 */
function escapes(board: Board, stone: number, depth: number, scratch: LadderScratch): boolean {
  if (depth >= LADDER_DEPTH || ++scratch.nodes > LADDER_NODES) return true;
  const { colour, head, next } = board;
  const { width } = board.geometry;
  const defender = colour[stone] as Colour;
  const attacker = (3 - defender) as Colour;
  const chain = head[stone];
  let at = chain;
  do {
    for (let k = 0; k < 4; k++) {
      const near = at + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      if (colour[near] === attacker && inAtari(board, head[near])) {
        const liberty = board.libSum[head[near]] / board.libCount[head[near]];
        if (isLegalFor(board, liberty, defender)) return true;
      }
    }
    at = next[at];
  } while (at !== chain);
  const liberty = board.libSum[chain] / board.libCount[chain];
  if (!isLegalFor(board, liberty, defender)) return false;
  const after = libertiesAfter(board, liberty, defender, 3);
  if (after >= 3) return true;
  if (after <= 1) return false;
  const extended = scratchBoard(scratch, depth, board);
  extended.toMove = defender;
  playMove(extended, liberty);
  return !attackSucceeds(extended, stone, attacker, depth + 1, scratch);
}

/** Empty neighbours of `point` other than `excluded`: three of them let a chain extending there escape outright. */
function openAround(board: Board, point: number, excluded: number): number {
  const { colour } = board;
  const { width } = board.geometry;
  let open = 0;
  for (let k = 0; k < 4; k++) {
    const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
    if (near !== excluded && colour[near] === EMPTY) open++;
  }
  return open;
}

/** Whether `attacker`, to move, captures the two-liberty chain through `stone` by chasing it with ataris. */
function attackSucceeds(board: Board, stone: number, attacker: Colour, depth: number, scratch: LadderScratch): boolean {
  if (depth >= LADDER_DEPTH || ++scratch.nodes > LADDER_NODES) return false;
  const libs = scratch.libs;
  if (chainLiberties(board, board.head[stone], 3, libs) !== 2) return false;
  const first = libs[0];
  const second = libs[1];
  for (let which = 0; which < 2; which++) {
    const liberty = which === 0 ? first : second;
    if (openAround(board, which === 0 ? second : first, liberty) >= 3 || !isLegalFor(board, liberty, attacker)) continue;
    // An atari that leaves the attacking stone itself in atari is usually answered by its capture.
    if (libertiesAfter(board, liberty, attacker, 2) < 2) continue;
    const chased = scratchBoard(scratch, depth, board);
    chased.toMove = attacker;
    playMove(chased, liberty);
    if (!inAtari(chased, chased.head[stone])) continue;
    chased.toMove = (3 - attacker) as Colour;
    if (!escapes(chased, stone, depth + 1, scratch)) return true;
  }
  return false;
}

/**
 * The attacking move that captures the two-liberty chain through `stone` in a ladder (its opponent to move), or
 * `PASS` when the chain escapes or the read runs too long.
 */
export function ladderAttack(board: Board, stone: number): number {
  const colour = board.colour[stone];
  if (colour === EMPTY || colour === EDGE) return PASS;
  const attacker = (3 - colour) as Colour;
  const scratch = scratchFor(board);
  scratch.nodes = 0;
  const libs = scratch.rootLibs;
  if (chainLiberties(board, board.head[stone], 3, libs) !== 2) return PASS;
  const first = libs[0];
  const second = libs[1];
  for (let which = 0; which < 2; which++) {
    const liberty = which === 0 ? first : second;
    if (openAround(board, which === 0 ? second : first, liberty) >= 3) continue;
    if (!isLegalFor(board, liberty, attacker) || libertiesAfter(board, liberty, attacker, 2) < 2) continue;
    const chased = scratchBoard(scratch, 0, board);
    chased.toMove = attacker;
    playMove(chased, liberty);
    if (!inAtari(chased, chased.head[stone])) continue;
    chased.toMove = colour as Colour;
    if (!escapes(chased, stone, 1, scratch)) return liberty;
  }
  return PASS;
}
