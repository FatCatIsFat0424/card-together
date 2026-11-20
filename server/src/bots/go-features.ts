// ─── Go bot move features: tactics, distances, and the feature ids of the fitted move model ───
//
// One analysis per position marks the tactical points (captures, escapes from atari, ataris with ladder status)
// and the common-fate-graph distances from the last two moves. The search turns them into priors; the offline
// fitting script (`scripts/go-model/`) reads the same feature ids, so the model and the bot cannot drift.

import { EDGE, EMPTY, PASS, chainLiberties, cloneBoard, copyBoard, inAtari, isLegal, playMove, selfAtariSize } from './go-board';
import type { Board, BoardGeometry, Colour } from './go-board';
import { ladderAttack, libertiesAfter } from './go-tactics';
import { MOGO_PATTERN, ownPatternCode, patternCode } from './go-patterns';

/** Capture kinds, strongest first. */
export const CAPTURE_LAST = 1;
export const CAPTURE_SAVES = 2;
export const CAPTURE_MANY = 3;
export const CAPTURE_ONE = 4;
/** Escape kinds for extending a chain in atari. */
export const ESCAPE_SAFE = 1;
export const ESCAPE_TWO = 2;
export const ESCAPE_LADDERED = 3;
/** Atari kinds. */
export const ATARI_LADDER = 1;
export const ATARI_PLAIN = 2;

/** Common-fate-graph distances above this are stored as this. */
export const FAR = 6;

export interface MoveAnalysis {
  /** Per padded point: a capture kind, escape kind, or atari kind; 0 for none. */
  readonly capture: Uint8Array;
  readonly escape: Uint8Array;
  readonly atari: Uint8Array;
  /** Per padded point: common-fate-graph distance from the last and the second-last move, capped at `FAR`. */
  readonly distLast: Uint8Array;
  readonly distLast2: Uint8Array;
}

const ANALYSES = new Map<number, { analysis: MoveAnalysis; libs: Int32Array; queue: Int32Array; board: Board | null }>();

function scratch(geometry: BoardGeometry): { analysis: MoveAnalysis; libs: Int32Array; queue: Int32Array; board: Board | null } {
  let entry = ANALYSES.get(geometry.size);
  if (!entry) {
    const { cells } = geometry;
    entry = {
      analysis: {
        capture: new Uint8Array(cells), escape: new Uint8Array(cells), atari: new Uint8Array(cells),
        distLast: new Uint8Array(cells), distLast2: new Uint8Array(cells),
      },
      libs: new Int32Array(4),
      queue: new Int32Array(cells * 2),
      board: null,
    };
    ANALYSES.set(geometry.size, entry);
  }
  return entry;
}

/** Breadth-first distances where a whole chain counts as one step: 0-1 BFS from `start`. */
function cfgDistances(board: Board, start: number, out: Uint8Array, queue: Int32Array): void {
  out.fill(FAR);
  if (start === PASS) return;
  const { colour, head } = board;
  const { width, cells } = board.geometry;
  // A deque in a ring buffer: zero-cost steps (within a chain) go to the front.
  let front = cells;
  let back = cells;
  out[start] = 0;
  queue[back++] = start;
  while (front < back) {
    const point = queue[front++];
    const distance = out[point];
    if (distance >= FAR - 1) continue;
    for (let k = 0; k < 4; k++) {
      const near = point + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
      const c = colour[near];
      if (c === EDGE) continue;
      const free = c !== EMPTY && colour[point] === c && head[point] === head[near];
      const step = free ? distance : distance + 1;
      if (step >= out[near]) continue;
      out[near] = step;
      if (free && front > 0) queue[--front] = near;
      else if (back < queue.length) queue[back++] = near;
    }
  }
}

/** Fills the analysis of the position for the side to move. */
export function analyzeMoves(board: Board): MoveAnalysis {
  const entry = scratch(board.geometry);
  const { analysis, libs } = entry;
  const { capture, escape, atari } = analysis;
  capture.fill(0);
  escape.fill(0);
  atari.fill(0);
  const { colour, head, next } = board;
  const { width, layout } = board.geometry;
  const own = board.toMove;
  const other = 3 - own;
  const lastChain = board.last !== PASS && colour[board.last] === other ? head[board.last] : PASS;
  const setCapture = (point: number, kind: number): void => {
    if (capture[point] === 0 || kind < capture[point]) capture[point] = kind;
  };
  for (const point of layout.toPoint) {
    const c = colour[point];
    if (c === EMPTY || head[point] !== point) continue;
    if (inAtari(board, point)) {
      const liberty = board.libSum[point] / board.libCount[point];
      if (c === other) {
        if (!isLegal(board, liberty)) continue;
        setCapture(liberty, point === lastChain ? CAPTURE_LAST : board.chainSize[point] > 1 ? CAPTURE_MANY : CAPTURE_ONE);
        continue;
      }
      // Our chain in atari: capturing a neighbour in atari saves it, and so may extending.
      let stone = point;
      do {
        for (let k = 0; k < 4; k++) {
          const near = stone + (k === 0 ? -width : k === 1 ? -1 : k === 2 ? 1 : width);
          if (colour[near] === other && inAtari(board, head[near])) {
            const take = board.libSum[head[near]] / board.libCount[head[near]];
            if (isLegal(board, take)) setCapture(take, CAPTURE_SAVES);
          }
        }
        stone = next[stone];
      } while (stone !== point);
      if (!isLegal(board, liberty)) continue;
      const after = libertiesAfter(board, liberty, own, 3);
      let kind = after >= 3 ? ESCAPE_SAFE : ESCAPE_LADDERED;
      if (after === 2) {
        entry.board ??= cloneBoard(board);
        copyBoard(board, entry.board);
        playMove(entry.board, liberty);
        kind = ladderAttack(entry.board, point) === PASS ? ESCAPE_TWO : ESCAPE_LADDERED;
      }
      if (escape[liberty] === 0 || kind < escape[liberty]) escape[liberty] = kind;
    } else if (c === other && chainLiberties(board, point, 3, libs) === 2) {
      const first = libs[0];
      const second = libs[1];
      const ladder = ladderAttack(board, point);
      for (const liberty of [first, second]) {
        const kind = liberty === ladder ? ATARI_LADDER : ATARI_PLAIN;
        if (atari[liberty] === 0 || kind < atari[liberty]) atari[liberty] = kind;
      }
    }
  }
  cfgDistances(board, board.last, analysis.distLast, entry.queue);
  cfgDistances(board, board.last2, analysis.distLast2, entry.queue);
  return analysis;
}

/** Points within Manhattan distance 3 of each padded point, on the board. */
const NEARBY = new Map<number, Int32Array[]>();

function nearbyPoints(geometry: BoardGeometry): Int32Array[] {
  let table = NEARBY.get(geometry.size);
  if (table) return table;
  const { size, width, cells, layout } = geometry;
  table = new Array<Int32Array>(cells).fill(new Int32Array(0));
  for (const point of layout.toPoint) {
    const index = layout.toIndex[point];
    const col = index % size;
    const row = Math.floor(index / size);
    const around: number[] = [];
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance === 0 || distance > 3) continue;
        if (col + dx < 0 || col + dx >= size || row + dy < 0 || row + dy >= size) continue;
        around.push(point + dy * width + dx);
      }
    }
    table[point] = Int32Array.from(around);
  }
  NEARBY.set(geometry.size, table);
  return table;
}

/** Whether no stone lies within Manhattan distance 3 of `point`. */
export function inEmptyArea(board: Board, point: number): boolean {
  const around = nearbyPoints(board.geometry)[point];
  const { colour } = board;
  for (let k = 0; k < around.length; k++) if (colour[around[k]] !== EMPTY) return false;
  return true;
}

// ─── Feature ids of the fitted model ───

export const PATTERN_FEATURES = 1 << 16;
export const CAPTURE_BASE = PATTERN_FEATURES;
export const ESCAPE_BASE = CAPTURE_BASE + 4;
export const ATARI_BASE = ESCAPE_BASE + 3;
export const SELF_ATARI_BASE = ATARI_BASE + 2;
/** Line 1–5 (5 for the fifth and beyond) times whether the area within distance 3 is empty. */
export const LINE_BASE = SELF_ATARI_BASE + 2;
/** Distance 1 to `FAR - 1` from the last move, then from the second-last. */
export const DIST_BASE = LINE_BASE + 10;
export const DIST2_BASE = DIST_BASE + FAR - 1;
export const FEATURE_COUNT = DIST2_BASE + FAR - 1;
/** Most features one move can carry. */
export const MAX_MOVE_FEATURES = 8;

/** Writes the feature ids of the side to move playing the empty `point` into `out`; returns their count. */
export function moveFeatures(board: Board, point: number, analysis: MoveAnalysis, out: Int32Array): number {
  let count = 0;
  out[count++] = ownPatternCode(board, point);
  if (analysis.capture[point] > 0) out[count++] = CAPTURE_BASE + analysis.capture[point] - 1;
  if (analysis.escape[point] > 0) out[count++] = ESCAPE_BASE + analysis.escape[point] - 1;
  if (analysis.atari[point] > 0) out[count++] = ATARI_BASE + analysis.atari[point] - 1;
  const selfAtari = selfAtariSize(board, point, board.toMove as Colour);
  if (selfAtari > 0) out[count++] = SELF_ATARI_BASE + (selfAtari > 1 ? 1 : 0);
  const line = Math.min(board.geometry.line[point], 5);
  out[count++] = LINE_BASE + (line - 1) * 2 + (inEmptyArea(board, point) ? 1 : 0);
  const distance = analysis.distLast[point];
  if (distance > 0 && distance < FAR) out[count++] = DIST_BASE + distance - 1;
  const distance2 = analysis.distLast2[point];
  if (distance2 > 0 && distance2 < FAR) out[count++] = DIST2_BASE + distance2 - 1;
  return count;
}

/** Whether `point` matches a MoGo playout shape (for the hand-set priors). */
export const mogoAt = (board: Board, point: number): boolean => MOGO_PATTERN[patternCode(board, point)] === 1;
