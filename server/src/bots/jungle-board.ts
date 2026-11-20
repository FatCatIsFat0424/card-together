// ─── Jungle search board: typed-array position, precomputed move tables, make and unmake ───
//
// The same rules as `@shared/rules/jungle`, restated over flat tables so the search can generate, make and unmake
// moves without allocating. `jungle-bot-strategy.test.ts` checks the generator against the shared rules on random games.

import {
  JG_CELLS, JG_COLS, JG_ELEPHANT, JG_LION, JG_RAT, JG_TIGER, jgDenCell, jgIsWater, jgTrapped,
} from '@shared/rules/jungle';

export const CELLS = JG_CELLS;
/** Moves are `from * 64 + to`. */
export const MOVE_SHIFT = 6;
export const MOVE_MASK = 63;
/** Most moves one side can have: eight pieces with four steps and four jumps. */
export const MAX_MOVES = 96;

export const WATER: Uint8Array = Uint8Array.from({ length: CELLS }, (_, index) => (jgIsWater(index) ? 1 : 0));
/** Side whose trap the cell is (a piece of the other side standing there has rank 0), or -1. */
export const TRAP_OWNER: Int8Array = Int8Array.from({ length: CELLS }, (_, index) =>
  (jgTrapped(index, 1) ? 0 : jgTrapped(index, 0) ? 1 : -1));
export const DEN: readonly [number, number] = [jgDenCell(0), jgDenCell(1)];

const MAX_STEPS = 4;
const MAX_JUMPS = 4;
const MAX_OVER = 3;

/** Orthogonal neighbours, `STEP_COUNT[cell]` of the `MAX_STEPS` slots in use. */
export const STEP: Int8Array = new Int8Array(CELLS * MAX_STEPS).fill(-1);
export const STEP_COUNT: Uint8Array = new Uint8Array(CELLS);
/** River jumps of lion and tiger: landing cell and the water cells crossed. */
export const JUMP_LAND: Int8Array = new Int8Array(CELLS * MAX_JUMPS).fill(-1);
export const JUMP_OVER: Int8Array = new Int8Array(CELLS * MAX_JUMPS * MAX_OVER).fill(-1);
export const JUMP_COUNT: Uint8Array = new Uint8Array(CELLS);

for (let cell = 0; cell < CELLS; cell++) {
  const col = cell % JG_COLS;
  const row = Math.floor(cell / JG_COLS);
  for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    const c = col + dc;
    const r = row + dr;
    if (c >= 0 && c < JG_COLS && r >= 0 && r < CELLS / JG_COLS) STEP[cell * MAX_STEPS + STEP_COUNT[cell]++] = r * JG_COLS + c;
  }
  if (WATER[cell]) continue;
  for (const [dc, dr] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    let c = col + dc;
    let r = row + dr;
    const over: number[] = [];
    while (c >= 0 && c < JG_COLS && r >= 0 && r < CELLS / JG_COLS && WATER[r * JG_COLS + c]) {
      over.push(r * JG_COLS + c);
      c += dc;
      r += dr;
    }
    if (over.length === 0 || c < 0 || c >= JG_COLS || r < 0 || r >= CELLS / JG_COLS) continue;
    const slot = cell * MAX_JUMPS + JUMP_COUNT[cell]++;
    JUMP_LAND[slot] = r * JG_COLS + c;
    over.forEach((water, index) => { JUMP_OVER[slot * MAX_OVER + index] = water; });
  }
}

export const pieceSide = (piece: number): number => (piece > 8 ? 1 : 0);
export const pieceRank = (piece: number): number => ((piece - 1) & 7) + 1;

/** Whether an attacker of this strength (0 when trapped) beats a defender of this rank on equal terrain. */
const BEATS: readonly Uint8Array[] = Array.from({ length: 9 }, (_, strength) => Uint8Array.from({ length: 9 }, (_, defence) => {
  if (strength === 0 || defence === 0) return 0;
  if (strength === JG_RAT && defence === JG_ELEPHANT) return 1;
  if (strength === JG_ELEPHANT && defence === JG_RAT) return 0;
  return strength >= defence ? 1 : 0;
}));

/** The searcher's board: cells hold piece codes (rank, plus 8 for side 1) and `loc` finds each piece. */
export interface Board {
  readonly cells: Int8Array;
  /** Cell of each piece code 1-16, or -1 once captured */
  readonly loc: Int8Array;
}

export function boardFrom(cells: ArrayLike<number>): Board {
  const board: Board = { cells: Int8Array.from(cells), loc: new Int8Array(17).fill(-1) };
  for (let index = 0; index < CELLS; index++) if (board.cells[index] !== 0) board.loc[board.cells[index]] = index;
  return board;
}

/** Whether `from` captures the piece on `to`, both occupied by opposite sides. */
export function canCapture(cells: Int8Array, from: number, to: number): boolean {
  if (WATER[from] !== WATER[to]) return false;
  const attacker = cells[from];
  const side = attacker > 8 ? 1 : 0;
  if (TRAP_OWNER[to] === side) return true;
  const strength = TRAP_OWNER[from] === 1 - side ? 0 : ((attacker - 1) & 7) + 1;
  return BEATS[strength][((cells[to] - 1) & 7) + 1] === 1;
}

/**
 * Writes the moves of `side` into `out` from `start` and returns how many. With `capturesOnly` only captures are
 * listed (a move into the enemy den is a plain step, so callers test den access separately).
 */
export function generate(board: Board, side: number, out: Int16Array, start: number, capturesOnly: boolean): number {
  const { cells, loc } = board;
  const ownDen = DEN[side];
  let count = start;
  const base = side * 8;
  for (let rank = 1; rank <= 8; rank++) {
    const from = loc[base + rank];
    if (from < 0) continue;
    const swimmer = rank === JG_RAT;
    const stepBase = from * MAX_STEPS;
    for (let step = 0; step < STEP_COUNT[from]; step++) {
      const to = STEP[stepBase + step];
      if (to === ownDen || (WATER[to] === 1 && !swimmer)) continue;
      const target = cells[to];
      if (target === 0) {
        if (!capturesOnly) out[count++] = (from << MOVE_SHIFT) | to;
      } else if (pieceSide(target) !== side && canCapture(cells, from, to)) out[count++] = (from << MOVE_SHIFT) | to;
    }
    if (rank !== JG_TIGER && rank !== JG_LION) continue;
    for (let jump = 0; jump < JUMP_COUNT[from]; jump++) {
      const slot = from * MAX_JUMPS + jump;
      const to = JUMP_LAND[slot];
      const over = slot * MAX_OVER;
      if (cells[JUMP_OVER[over]] !== 0 || (JUMP_OVER[over + 1] >= 0 && cells[JUMP_OVER[over + 1]] !== 0)
        || (JUMP_OVER[over + 2] >= 0 && cells[JUMP_OVER[over + 2]] !== 0)) continue;
      const target = cells[to];
      if (target === 0) {
        if (!capturesOnly) out[count++] = (from << MOVE_SHIFT) | to;
      } else if (pieceSide(target) !== side && canCapture(cells, from, to)) out[count++] = (from << MOVE_SHIFT) | to;
    }
  }
  return count - start;
}

/** The three cells next to each den, where an enemy piece is one step from winning. */
export const DEN_GATES: readonly (readonly number[])[] = [0, 1].map((side) =>
  Array.from({ length: STEP_COUNT[DEN[side]] }, (_, index) => STEP[DEN[side] * MAX_STEPS + index]));

/** Whether a piece of `side` stands next to the enemy den, so its next move wins. */
export function atEnemyGate(board: Board, side: number): boolean {
  const gates = DEN_GATES[1 - side];
  for (let index = 0; index < gates.length; index++) {
    const piece = board.cells[gates[index]];
    if (piece !== 0 && pieceSide(piece) === side) return true;
  }
  return false;
}
