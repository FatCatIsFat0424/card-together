// ─── Gomoku position: a padded board with line shapes kept per intersection and axis ───
//
// Every empty intersection remembers, for each side and each of the four axes, the shape one stone of that
// side would make there (`gomoku-patterns`). A move changes the windows of at most 32 neighbours, so the
// shapes, the threat sets, the candidate set, the evaluation counts, and the Zobrist hash all update in a few
// dozen steps and undo exactly. Indices outside this file's own methods are intersection indices (0-224)
// unless named `cell`, which is a padded-board index.

import { GM_CELLS, GM_SIZE, gmForbiddenInPlace, gmWins } from '@shared/rules/gomoku';
import type { GmCell, GmSide } from '@shared/rules/gomoku';
import { FIVE, FOUR, OPEN_THREE, shapeOf } from './gomoku-patterns';

/** Margin of wall cells around the board: a window reaches four steps. */
const MARGIN = 4;
export const WIDTH = GM_SIZE + 2 * MARGIN;
export const AREA = WIDTH * WIDTH;

/** Cell step of the four axes: across, down, and both diagonals. */
export const STEPS: readonly number[] = [1, WIDTH, WIDTH + 1, WIDTH - 1];

export const CELL_OF = new Int16Array(GM_CELLS);
export const INDEX_OF = new Int16Array(AREA).fill(-1);
for (let index = 0; index < GM_CELLS; index++) {
  const cell = (Math.floor(index / GM_SIZE) + MARGIN) * WIDTH + (index % GM_SIZE) + MARGIN;
  CELL_OF[index] = cell;
  INDEX_OF[cell] = index;
}

/** Padded cells within two steps of each cell, as a flat table: `NEAR_START[cell]` to `NEAR_START[cell + 1]`. */
const NEAR_START = new Int32Array(AREA + 1);
const NEAR_CELLS: number[] = [];
for (let cell = 0; cell < AREA; cell++) {
  NEAR_START[cell] = NEAR_CELLS.length;
  if (INDEX_OF[cell] < 0) continue;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const other = cell + dr * WIDTH + dc;
      if ((dr !== 0 || dc !== 0) && INDEX_OF[other] >= 0) NEAR_CELLS.push(other);
    }
  }
}
NEAR_START[AREA] = NEAR_CELLS.length;
const NEAR = Int16Array.from(NEAR_CELLS);

/** Pseudo-random 32-bit values for the hash, fixed so that positions hash the same in every worker. */
function zobristTable(seed: number): Int32Array {
  const table = new Int32Array(2 * AREA);
  let state = seed;
  for (let i = 0; i < table.length; i++) {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    table[i] = (t ^ (t >>> 14)) | 0;
  }
  return table;
}
const ZOBRIST_A = zobristTable(0x9e3779b9);
const ZOBRIST_B = zobristTable(0x85ebca6b);
/** Mixed into the second hash word when white is to move. */
export const SIDE_HASH = 0x2545f491;

/** A set of padded cells with constant-time add, remove, and iteration over `list[0 .. size)`. */
export class CellSet {
  readonly list = new Int16Array(GM_CELLS);
  private readonly slot = new Int16Array(AREA).fill(-1);
  size = 0;

  add(cell: number): void {
    if (this.slot[cell] >= 0) return;
    this.slot[cell] = this.size;
    this.list[this.size++] = cell;
  }

  remove(cell: number): void {
    const at = this.slot[cell];
    if (at < 0) return;
    const last = this.list[--this.size];
    this.list[at] = last;
    this.slot[last] = at;
    this.slot[cell] = -1;
  }
}

/** Strength of a shape in the static evaluation: what a stone that would make it is worth to its side. */
const SHAPE_VALUE: readonly number[] = [0, 2, 6, 5, 40, 60, 400, 0];

/** The side's stones and the board around them, with everything the search reads kept up to date. */
export class Position {
  /** Intersection contents, 15 × 15 */
  readonly stones: GmCell[] = new Array<GmCell>(GM_CELLS).fill(null);
  /** Padded board: 0 empty, 1 black, 2 white, 3 wall */
  readonly board = new Uint8Array(AREA);
  /** Nine-cell window per axis and cell, two bits per cell */
  private readonly keys = new Int32Array(4 * AREA);
  /** Shape per side, axis, and cell */
  private readonly shapes = new Uint8Array(8 * AREA);
  /** Strongest shape over the four axes, per side and cell; 0 on a taken cell */
  readonly best = new Uint8Array(2 * AREA);
  /** Empty cells holding each shape, per side (index `side * 8 + shape`) */
  readonly counts = new Int32Array(16);
  /** Cells where a stone of the side makes five / at least a four / at least an open three */
  readonly fives: readonly [CellSet, CellSet] = [new CellSet(), new CellSet()];
  readonly fours: readonly [CellSet, CellSet] = [new CellSet(), new CellSet()];
  readonly threes: readonly [CellSet, CellSet] = [new CellSet(), new CellSet()];
  /** Empty cells within two steps of a stone */
  readonly candidates = new CellSet();
  private readonly near = new Uint8Array(AREA);
  /** The two halves of the Zobrist hash of the stones */
  hashA = 0;
  hashB = 0;
  stoneCount = 0;
  /** Renju: black may not play forbidden points and needs exactly five */
  renju: boolean;
  /** Winning cells found by the last `winCells` call */
  readonly wins = new Int16Array(4);

  constructor(stones: readonly GmCell[] = [], renju = false) {
    this.renju = renju;
    this.board.fill(3);
    for (let index = 0; index < GM_CELLS; index++) this.board[CELL_OF[index]] = 0;
    for (let cell = 0; cell < AREA; cell++) {
      if (INDEX_OF[cell] < 0) continue;
      for (let axis = 0; axis < 4; axis++) {
        let key = 0;
        for (let k = -MARGIN; k <= MARGIN; k++) key |= this.board[cell + k * STEPS[axis]] << (2 * (k + MARGIN));
        this.keys[axis * AREA + cell] = key;
      }
      for (let axis = 0; axis < 4; axis++) this.reshape(cell, axis);
    }
    stones.forEach((side, index) => {
      if (side !== null) this.make(index, side);
    });
  }

  /** Recomputes the shape of one cell and axis from its window and files it. */
  private reshape(cell: number, axis: number): void {
    const key = this.keys[axis * AREA + cell];
    for (let side = 0; side < 2; side++) {
      const at = (side * 4 + axis) * AREA + cell;
      const old = this.shapes[at];
      const next = shapeOf(side as GmSide, key);
      if (old === next) continue;
      if (old > 0) this.counts[side * 8 + old]--;
      if (next > 0) this.counts[side * 8 + next]++;
      this.shapes[at] = next;
      this.settle(side, cell);
    }
  }

  /** Refreshes a cell's strongest shape and its threat-set membership. */
  private settle(side: number, cell: number): void {
    const base = side * 4 * AREA + cell;
    let top = this.shapes[base];
    for (let axis = 1; axis < 4; axis++) if (this.shapes[base + axis * AREA] > top) top = this.shapes[base + axis * AREA];
    const old = this.best[side * AREA + cell];
    if (top === old) return;
    this.best[side * AREA + cell] = top;
    this.file(this.fives[side], cell, top >= FIVE, old >= FIVE);
    this.file(this.fours[side], cell, top >= FOUR, old >= FOUR);
    this.file(this.threes[side], cell, top >= OPEN_THREE, old >= OPEN_THREE);
  }

  private file(set: CellSet, cell: number, now: boolean, before: boolean): void {
    if (now === before) return;
    if (now) set.add(cell);
    else set.remove(cell);
  }

  /** The shape a stone of `side` would make at `cell` on `axis`. */
  shape(side: number, axis: number, cell: number): number {
    return this.shapes[(side * 4 + axis) * AREA + cell];
  }

  /** Puts a stone on a padded cell. */
  makeCell(cell: number, side: GmSide): void {
    const code = side + 1;
    for (let axis = 0; axis < 4; axis++) {
      for (let s = 0; s < 2; s++) {
        const at = (s * 4 + axis) * AREA + cell;
        if (this.shapes[at] > 0) this.counts[s * 8 + this.shapes[at]]--;
        this.shapes[at] = 0;
      }
    }
    this.settle(0, cell);
    this.settle(1, cell);
    this.board[cell] = code;
    this.stones[INDEX_OF[cell]] = side;
    this.stoneCount++;
    this.hashA ^= ZOBRIST_A[side * AREA + cell];
    this.hashB ^= ZOBRIST_B[side * AREA + cell];
    this.candidates.remove(cell);
    for (let i = NEAR_START[cell]; i < NEAR_START[cell + 1]; i++) {
      const other = NEAR[i];
      if (this.near[other]++ === 0 && this.board[other] === 0) this.candidates.add(other);
    }
    for (let axis = 0; axis < 4; axis++) {
      const step = STEPS[axis];
      this.keys[axis * AREA + cell] += code << (2 * MARGIN);
      for (let k = 1; k <= MARGIN; k++) {
        const ahead = cell + k * step;
        if (this.board[ahead] !== 3) {
          this.keys[axis * AREA + ahead] += code << (2 * (MARGIN - k));
          if (this.board[ahead] === 0) this.reshape(ahead, axis);
        }
        const behind = cell - k * step;
        if (this.board[behind] !== 3) {
          this.keys[axis * AREA + behind] += code << (2 * (MARGIN + k));
          if (this.board[behind] === 0) this.reshape(behind, axis);
        }
      }
    }
  }

  /** Takes back the stone of `side` on a padded cell. */
  unmakeCell(cell: number, side: GmSide): void {
    const code = side + 1;
    this.board[cell] = 0;
    this.stones[INDEX_OF[cell]] = null;
    this.stoneCount--;
    this.hashA ^= ZOBRIST_A[side * AREA + cell];
    this.hashB ^= ZOBRIST_B[side * AREA + cell];
    for (let i = NEAR_START[cell]; i < NEAR_START[cell + 1]; i++) {
      const other = NEAR[i];
      if (--this.near[other] === 0 && this.board[other] === 0) this.candidates.remove(other);
    }
    if (this.near[cell] > 0) this.candidates.add(cell);
    for (let axis = 0; axis < 4; axis++) {
      const step = STEPS[axis];
      this.keys[axis * AREA + cell] -= code << (2 * MARGIN);
      for (let k = 1; k <= MARGIN; k++) {
        const ahead = cell + k * step;
        if (this.board[ahead] !== 3) {
          this.keys[axis * AREA + ahead] -= code << (2 * (MARGIN - k));
          if (this.board[ahead] === 0) this.reshape(ahead, axis);
        }
        const behind = cell - k * step;
        if (this.board[behind] !== 3) {
          this.keys[axis * AREA + behind] -= code << (2 * (MARGIN + k));
          if (this.board[behind] === 0) this.reshape(behind, axis);
        }
      }
    }
    for (let axis = 0; axis < 4; axis++) this.reshape(cell, axis);
  }

  make(index: number, side: GmSide): void {
    this.makeCell(CELL_OF[index], side);
  }

  unmake(index: number, side: GmSide): void {
    this.unmakeCell(CELL_OF[index], side);
  }

  /** Whether black may not play this empty cell under Renju; cheap shape tests rule out most cells first. */
  private forbidden(cell: number): boolean {
    let threes = 0;
    for (let axis = 0; axis < 4; axis++) {
      const shape = this.shapes[axis * AREA + cell];
      if (shape >= FOUR) return gmForbiddenInPlace(this.stones, INDEX_OF[cell]);
      if (shape >= OPEN_THREE) threes++;
    }
    return threes >= 2 && gmForbiddenInPlace(this.stones, INDEX_OF[cell]);
  }

  /** Whether `side` may play the empty cell: black avoids forbidden points under Renju. */
  legal(cell: number, side: GmSide): boolean {
    return this.board[cell] === 0 && !(this.renju && side === 0 && this.forbidden(cell));
  }

  /**
   * Fills `wins` with the empty cells where `side` completes a winning line and returns how many (at most 4);
   * under Renju black needs exactly five.
   */
  winCells(side: GmSide): number {
    const set = this.fives[side];
    if (set.size === 0) return 0;
    let count = 0;
    for (let i = 0; i < set.size && count < 4; i++) {
      const cell = set.list[i];
      if (this.renju && side === 0 && !gmWins(this.stones, INDEX_OF[cell], 0, true)) continue;
      this.wins[count++] = cell;
    }
    return count;
  }

  /** Static value for `side` to move: the shapes it can make minus the opponent's, which cost it a move to use. */
  evaluate(side: GmSide): number {
    const own = side * 8;
    const other = (1 - side) * 8;
    let value = 0;
    for (let shape = 1; shape < FIVE; shape++) {
      value += SHAPE_VALUE[shape] * (this.counts[own + shape] - 0.7 * this.counts[other + shape]);
    }
    return value;
  }
}
