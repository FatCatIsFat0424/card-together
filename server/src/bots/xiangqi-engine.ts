// ─── Xiangqi search board: incremental make/unmake, Zobrist hashing, move generation, and house-rule repetition ───
//
// A mutable board for the bot's search with the hash, piece counts, and undo stacks it needs. Cells, engine codes,
// and move packing match `@shared/rules/xiangqi` (row 0 is black's back rank, red positive, `from << 7 | to`), so
// a returned move is one the rules accept; perft tests compare the generator with the shared one.

import * as xiangqiRules from '@shared/rules/xiangqi';
import type { XqBoard, XqPly, XqSide } from '@shared/rules/xiangqi';

// Imported bindings are read once into module constants: under the CommonJS loader every use of an imported
// binding is a getter call, which costs measurably in the search's inner loops.
const {
  XQ_ADVISOR, XQ_CANNON, XQ_CELLS, XQ_CHARIOT, XQ_COL, XQ_ELEPHANT, XQ_GENERAL, XQ_HORSE, XQ_ROW, XQ_SOLDIER, xqEngineBoard,
} = xiangqiRules;

export const XQ_MAX_PLY = 128;
/** Plies without a capture that draw (`XQ_NO_CAPTURE_PLIES`). */
export const XQ_QUIET_LIMIT = 120;
const HISTORY_SLOTS = 160;

// ─── Geometry tables ───

const inside = (col: number, row: number): boolean => col >= 0 && col < 9 && row >= 0 && row < 10;
const cellAt = (col: number, row: number): number => row * 9 + col;
const inPalace = (side: number, col: number, row: number): boolean =>
  col >= 3 && col <= 5 && (side === 0 ? row >= 7 : row <= 2);
const ownHalf = (side: number, row: number): boolean => (side === 0 ? row >= 5 : row <= 4);

/** Fixed-size target lists: `list[(side * 90 + cell) * 8 + i]` for `count[side * 90 + cell]` entries. */
interface Steps {
  readonly list: Int8Array;
  readonly count: Uint8Array;
  /** Blocking point per target (elephant eye, horse leg), or −1. */
  readonly block: Int8Array;
}

function steps(build: (side: number, col: number, row: number) => [number, number, number][]): Steps {
  const list = new Int8Array(2 * 90 * 8);
  const count = new Uint8Array(2 * 90);
  const block = new Int8Array(2 * 90 * 8).fill(-1);
  for (let side = 0; side < 2; side++) {
    for (let cell = 0; cell < 90; cell++) {
      for (const [target, blocker] of build(side, cell % 9, Math.floor(cell / 9)).map(([c, r, b]) => [cellAt(c, r), b])) {
        const slot = (side * 90 + cell) * 8 + count[side * 90 + cell]++;
        list[slot] = target;
        block[slot] = blocker;
      }
    }
  }
  return { list, count, block };
}

const ORTHOGONAL: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIAGONAL: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
/** Horse jumps as [dc, dr, leg dc, leg dr]. */
const HORSE_JUMPS: readonly (readonly [number, number, number, number])[] = [
  [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1],
  [-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0],
];

export const GENERAL_STEPS = steps((side, col, row) => ORTHOGONAL
  .filter(([dc, dr]) => inside(col + dc, row + dr) && inPalace(side, col + dc, row + dr))
  .map(([dc, dr]) => [col + dc, row + dr, -1]));
export const ADVISOR_STEPS = steps((side, col, row) => DIAGONAL
  .filter(([dc, dr]) => inside(col + dc, row + dr) && inPalace(side, col + dc, row + dr))
  .map(([dc, dr]) => [col + dc, row + dr, -1]));
export const ELEPHANT_STEPS = steps((side, col, row) => DIAGONAL
  .filter(([dc, dr]) => inside(col + 2 * dc, row + 2 * dr) && ownHalf(side, row + 2 * dr))
  .map(([dc, dr]) => [col + 2 * dc, row + 2 * dr, cellAt(col + dc, row + dr)]));
export const HORSE_STEPS = steps((_side, col, row) => HORSE_JUMPS
  .filter(([dc, dr]) => inside(col + dc, row + dr))
  .map(([dc, dr, lc, lr]) => [col + dc, row + dr, cellAt(col + lc, row + lr)]));
export const SOLDIER_STEPS = steps((side, col, row) => {
  const forward = side === 0 ? -1 : 1;
  const targets: [number, number, number][] = [];
  if (inside(col, row + forward)) targets.push([col, row + forward, -1]);
  if (!ownHalf(side, row)) {
    if (col > 0) targets.push([col - 1, row, -1]);
    if (col < 8) targets.push([col + 1, row, -1]);
  }
  return targets;
});

/** Horses that would attack a cell: `HORSE_ATTACKERS[cell * 8 + i]` with its leg in `HORSE_ATTACK_LEGS`. */
const HORSE_ATTACKERS = new Int8Array(90 * 8);
const HORSE_ATTACK_LEGS = new Int8Array(90 * 8);
const HORSE_ATTACK_COUNT = new Uint8Array(90);
for (let horse = 0; horse < 90; horse++) {
  for (let index = 0; index < HORSE_STEPS.count[horse]; index++) {
    const target = HORSE_STEPS.list[horse * 8 + index];
    const slot = target * 8 + HORSE_ATTACK_COUNT[target]++;
    HORSE_ATTACKERS[slot] = horse;
    HORSE_ATTACK_LEGS[slot] = HORSE_STEPS.block[horse * 8 + index];
  }
}

/** Orthogonal rays: `RAY[(cell * 4 + direction) * 10 + i]`, `RAY_LENGTH[cell * 4 + direction]`; directions up, down, left, right. */
export const RAY = new Int8Array(90 * 4 * 10);
export const RAY_LENGTH = new Uint8Array(90 * 4);
for (let cell = 0; cell < 90; cell++) {
  ORTHOGONAL.forEach(([dc, dr], direction) => {
    let length = 0;
    for (let col = cell % 9 + dc, row = Math.floor(cell / 9) + dr; inside(col, row); col += dc, row += dr) {
      RAY[(cell * 4 + direction) * 10 + length++] = cellAt(col, row);
    }
    RAY_LENGTH[cell * 4 + direction] = length;
  });
}

// ─── Zobrist keys ───

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}

const keyStream = mulberry(0x5eed_c0de);
/** Indexed `(code + 7) * 90 + cell`. */
const Z_LOW = Int32Array.from({ length: 15 * 90 }, keyStream);
const Z_HIGH = Int32Array.from({ length: 15 * 90 }, keyStream);
const Z_SIDE_LOW = keyStream();
const Z_SIDE_HIGH = keyStream();

// ─── State ───

export interface XqBoardState {
  /** Engine codes per cell: red 1–7, black −1…−7. */
  readonly cells: Int8Array;
  side: XqSide;
  /** Plies since the last capture. */
  quiet: number;
  readonly kings: Int32Array;
  hashLow: number;
  hashHigh: number;
  /** Piece counts by `code + 7`. */
  readonly counts: Int32Array;
  ply: number;
  readonly undoCaptured: Int8Array;
  readonly undoQuiet: Int32Array;
  /** Hashes of the positions before the current one, oldest first, since before the last capture. */
  readonly historyLow: Int32Array;
  readonly historyHigh: Int32Array;
  /** `checks[k]`: the move into position k gave check; `checks[historyLength]` is the current position's. */
  readonly checks: Uint8Array;
  historyLength: number;
}

export function xqHashOf(cells: Int8Array, side: XqSide): { low: number; high: number } {
  let low = side === 1 ? Z_SIDE_LOW : 0;
  let high = side === 1 ? Z_SIDE_HIGH : 0;
  for (let cell = 0; cell < 90; cell++) {
    const piece = cells[cell];
    if (piece === 0) continue;
    low ^= Z_LOW[(piece + 7) * 90 + cell];
    high ^= Z_HIGH[(piece + 7) * 90 + cell];
  }
  return { low, high };
}

/**
 * The search board for `board` with `side` to move after `plies` (every move of the game). The positions since
 * the last capture, with which moves gave check, feed the repetition rules.
 */
export function xqBoardState(board: XqBoard, side: XqSide, plies: readonly XqPly[]): XqBoardState {
  const cells = xqEngineBoard(board);
  const counts = new Int32Array(15);
  const kings = new Int32Array([-1, -1]);
  for (let cell = 0; cell < XQ_CELLS; cell++) {
    const piece = cells[cell];
    if (piece === 0) continue;
    counts[piece + 7]++;
    if (piece === XQ_GENERAL) kings[0] = cell;
    else if (piece === -XQ_GENERAL) kings[1] = cell;
  }
  const { low, high } = xqHashOf(cells, side);
  const size = HISTORY_SLOTS + XQ_MAX_PLY + 8;
  const state: XqBoardState = {
    cells, side, quiet: 0, kings, hashLow: low, hashHigh: high, counts, ply: 0,
    undoCaptured: new Int8Array(XQ_MAX_PLY + 8), undoQuiet: new Int32Array(XQ_MAX_PLY + 8),
    historyLow: new Int32Array(size), historyHigh: new Int32Array(size), checks: new Uint8Array(size + 1), historyLength: 0,
  };
  // Walk back through the quiet plies, rebuilding each earlier position.
  let quiet = 0;
  for (let index = plies.length - 1; index >= 0 && plies[index].captured === null; index--) quiet++;
  state.quiet = quiet;
  const kept = Math.min(quiet, HISTORY_SLOTS);
  const back = Int8Array.from(cells);
  let toMove = side;
  const lows: number[] = [];
  const highs: number[] = [];
  const checks: boolean[] = [];
  for (let step = 0; step < kept; step++) {
    const ply = plies[plies.length - 1 - step];
    checks.push(ply.check);
    back[ply.from] = back[ply.to];
    back[ply.to] = 0;
    toMove = toMove === 0 ? 1 : 0;
    const hash = xqHashOf(back, toMove);
    lows.push(hash.low);
    highs.push(hash.high);
  }
  // Oldest first: position k (0-based) and the check flag of the move into it.
  for (let index = 0; index < kept; index++) {
    state.historyLow[index] = lows[kept - 1 - index];
    state.historyHigh[index] = highs[kept - 1 - index];
  }
  // checks[] above runs newest first: checks[0] is the move into the current position.
  for (let index = 1; index <= kept; index++) state.checks[index] = checks[kept - index] ? 1 : 0;
  state.historyLength = kept;
  return state;
}

// ─── Check detection ───

/** Whether `side`'s general is attacked, including by the facing general. */
export function xqStateInCheck(state: XqBoardState, side: XqSide): boolean {
  const { cells } = state;
  const king = state.kings[side];
  const enemy = side === 0 ? -1 : 1;
  for (let direction = 0; direction < 4; direction++) {
    const base = (king * 4 + direction) * 10;
    const length = RAY_LENGTH[king * 4 + direction];
    let step = 0;
    for (; step < length; step++) {
      const piece = cells[RAY[base + step]];
      if (piece === 0) continue;
      if (piece === enemy * XQ_CHARIOT || (direction < 2 && piece === enemy * XQ_GENERAL)) return true;
      break;
    }
    for (step++; step < length; step++) {
      const piece = cells[RAY[base + step]];
      if (piece === 0) continue;
      if (piece === enemy * XQ_CANNON) return true;
      break;
    }
  }
  const horse = enemy * XQ_HORSE;
  for (let index = king * 8, end = index + HORSE_ATTACK_COUNT[king]; index < end; index++) {
    if (cells[HORSE_ATTACKERS[index]] === horse && cells[HORSE_ATTACK_LEGS[index]] === 0) return true;
  }
  const soldier = enemy * XQ_SOLDIER;
  // An enemy soldier attacks from the row behind the general (as the enemy advances) or beside it.
  const behind = king + (side === 0 ? -9 : 9);
  if (behind >= 0 && behind < 90 && cells[behind] === soldier) return true;
  const col = XQ_COL[king];
  if (col > 0 && cells[king - 1] === soldier) return true;
  if (col < 8 && cells[king + 1] === soldier) return true;
  return false;
}

// ─── Move generation ───

/** Appends the side to move's pseudo-legal moves (`from << 7 | to`) from `start`; returns the new end. */
export function xqGenerateMoves(state: XqBoardState, out: Int32Array, start: number, capturesOnly: boolean): number {
  const { cells } = state;
  const side = state.side;
  const sign = side === 0 ? 1 : -1;
  let end = start;
  for (let from = 0; from < 90; from++) {
    const kind = cells[from] * sign;
    if (kind <= 0) continue;
    if (kind === XQ_CHARIOT || kind === XQ_CANNON) {
      for (let direction = 0; direction < 4; direction++) {
        const base = (from * 4 + direction) * 10;
        const length = RAY_LENGTH[from * 4 + direction];
        let step = 0;
        for (; step < length; step++) {
          const to = RAY[base + step];
          const target = cells[to] * sign;
          if (target === 0) {
            if (!capturesOnly) out[end++] = (from << 7) | to;
            continue;
          }
          if (kind === XQ_CHARIOT && target < 0) out[end++] = (from << 7) | to;
          break;
        }
        if (kind !== XQ_CANNON) continue;
        for (step++; step < length; step++) {
          const to = RAY[base + step];
          const target = cells[to] * sign;
          if (target === 0) continue;
          if (target < 0) out[end++] = (from << 7) | to;
          break;
        }
      }
      continue;
    }
    const table = kind === XQ_HORSE ? HORSE_STEPS : kind === XQ_SOLDIER ? SOLDIER_STEPS : kind === XQ_ELEPHANT ? ELEPHANT_STEPS
      : kind === XQ_ADVISOR ? ADVISOR_STEPS : GENERAL_STEPS;
    const slot = side * 90 + from;
    for (let index = slot * 8, last = index + table.count[slot]; index < last; index++) {
      const blocker = table.block[index];
      if (blocker >= 0 && cells[blocker] !== 0) continue;
      const to = table.list[index];
      const target = cells[to] * sign;
      if (target > 0 || (capturesOnly && target === 0)) continue;
      out[end++] = (from << 7) | to;
    }
  }
  return end;
}

// ─── Make and unmake ───

/** Plays a pseudo-legal move in place; the caller records whether it gave check in `checks[historyLength]`. */
export function xqMakeMove(state: XqBoardState, move: number): void {
  const { cells } = state;
  const from = move >> 7;
  const to = move & 127;
  const piece = cells[from];
  const captured = cells[to];
  const ply = state.ply++;
  state.undoCaptured[ply] = captured;
  state.undoQuiet[ply] = state.quiet;
  state.historyLow[state.historyLength] = state.hashLow;
  state.historyHigh[state.historyLength] = state.hashHigh;
  state.historyLength++;
  state.checks[state.historyLength] = 0;
  let low = state.hashLow ^ Z_LOW[(piece + 7) * 90 + from] ^ Z_LOW[(piece + 7) * 90 + to] ^ Z_SIDE_LOW;
  let high = state.hashHigh ^ Z_HIGH[(piece + 7) * 90 + from] ^ Z_HIGH[(piece + 7) * 90 + to] ^ Z_SIDE_HIGH;
  if (captured !== 0) {
    low ^= Z_LOW[(captured + 7) * 90 + to];
    high ^= Z_HIGH[(captured + 7) * 90 + to];
    state.counts[captured + 7]--;
    state.quiet = 0;
  } else {
    state.quiet++;
  }
  state.hashLow = low;
  state.hashHigh = high;
  cells[to] = piece;
  cells[from] = 0;
  if (piece === XQ_GENERAL) state.kings[0] = to;
  else if (piece === -XQ_GENERAL) state.kings[1] = to;
  state.side = state.side === 0 ? 1 : 0;
}

export function xqUnmakeMove(state: XqBoardState, move: number): void {
  const { cells } = state;
  const from = move >> 7;
  const to = move & 127;
  const ply = --state.ply;
  state.historyLength--;
  const piece = cells[to];
  const captured = state.undoCaptured[ply];
  cells[from] = piece;
  cells[to] = captured;
  if (captured !== 0) state.counts[captured + 7]++;
  if (piece === XQ_GENERAL) state.kings[0] = from;
  else if (piece === -XQ_GENERAL) state.kings[1] = from;
  state.quiet = state.undoQuiet[ply];
  state.hashLow = state.historyLow[state.historyLength];
  state.hashHigh = state.historyHigh[state.historyLength];
  state.side = state.side === 0 ? 1 : 0;
}

/** Passes the turn for null-move pruning; repetition scans stop at it. */
export function xqMakeNull(state: XqBoardState): void {
  const ply = state.ply++;
  state.undoCaptured[ply] = 0;
  state.undoQuiet[ply] = state.quiet;
  state.historyLow[state.historyLength] = state.hashLow;
  state.historyHigh[state.historyLength] = state.hashHigh;
  state.historyLength++;
  state.checks[state.historyLength] = 0;
  state.quiet = 0;
  state.hashLow ^= Z_SIDE_LOW;
  state.hashHigh ^= Z_SIDE_HIGH;
  state.side = state.side === 0 ? 1 : 0;
}

export function xqUnmakeNull(state: XqBoardState): void {
  const ply = --state.ply;
  state.historyLength--;
  state.quiet = state.undoQuiet[ply];
  state.hashLow = state.historyLow[state.historyLength];
  state.hashHigh = state.historyHigh[state.historyLength];
  state.side = state.side === 0 ? 1 : 0;
}

/** Repetition outcome for the side to move: no repetition, a draw, or a loss for one side's perpetual check. */
export const XQ_REPEAT_NONE = 0;
export const XQ_REPEAT_DRAW = 1;
export const XQ_REPEAT_WIN = 2;
export const XQ_REPEAT_LOSS = 3;

/**
 * Judges a return to an earlier position (same side to move) since the last capture the way the house rules judge
 * the third occurrence: a side whose every move in the cycle gave check loses, unless both did; otherwise a draw.
 * The search applies it at the first return, since either side could repeat the cycle once more. The span runs
 * from the earliest occurrence, as in `xqVerdict`.
 */
export function xqRepetition(state: XqBoardState): number {
  const current = state.historyLength;
  const oldest = Math.max(0, current - state.quiet);
  let first = -1;
  for (let index = current - 2; index >= oldest; index -= 2) {
    if (state.historyLow[index] === state.hashLow && state.historyHigh[index] === state.hashHigh) first = index;
  }
  if (first < 0) return XQ_REPEAT_NONE;
  // Moves into positions current, current − 2, … were the opponent's; current − 1, … the side to move's.
  let opponentChecks = true;
  let ownChecks = true;
  for (let index = current; index > first; index--) {
    if (state.checks[index] !== 0) continue;
    if ((current - index) % 2 === 0) opponentChecks = false;
    else ownChecks = false;
  }
  if (opponentChecks && !ownChecks) return XQ_REPEAT_WIN;
  if (ownChecks && !opponentChecks) return XQ_REPEAT_LOSS;
  return XQ_REPEAT_DRAW;
}

// ─── Static exchange evaluation ───

export const XQ_SEE_VALUE = [0, 10_000, 200, 200, 400, 900, 450, 100];

/** Advisors, elephants, and the general move symmetrically, so their step tables also list who attacks a cell. */
const STEP_MOVERS: readonly (readonly [Steps, number])[] = [
  [ADVISOR_STEPS, XQ_ADVISOR], [ELEPHANT_STEPS, XQ_ELEPHANT], [GENERAL_STEPS, XQ_GENERAL],
];

/**
 * Pieces of `side` attacking `cell`, with their cells, appended to `out` from 0; returns the count. Blocking
 * pieces count as on the board, so x-rays and cannon screens follow the board as it is when called.
 */
function attackersOf(cells: Int8Array, cell: number, side: XqSide, out: Int8Array): number {
  const sign = side === 0 ? 1 : -1;
  let count = 0;
  for (let direction = 0; direction < 4; direction++) {
    const base = (cell * 4 + direction) * 10;
    const length = RAY_LENGTH[cell * 4 + direction];
    let step = 0;
    for (; step < length; step++) {
      const at = RAY[base + step];
      const piece = cells[at];
      if (piece === 0) continue;
      if (piece === sign * XQ_CHARIOT) out[count++] = at;
      break;
    }
    for (step++; step < length; step++) {
      const at = RAY[base + step];
      const piece = cells[at];
      if (piece === 0) continue;
      if (piece === sign * XQ_CANNON) out[count++] = at;
      break;
    }
  }
  for (let index = cell * 8, end = index + HORSE_ATTACK_COUNT[cell]; index < end; index++) {
    if (cells[HORSE_ATTACKERS[index]] === sign * XQ_HORSE && cells[HORSE_ATTACK_LEGS[index]] === 0) out[count++] = HORSE_ATTACKERS[index];
  }
  // Step movers: their moves are symmetric except soldiers, which attack forward and, once across, sideways.
  const col = XQ_COL[cell];
  const row = XQ_ROW[cell];
  const soldier = sign * XQ_SOLDIER;
  const behind = cell + (side === 0 ? 9 : -9);
  if (behind >= 0 && behind < 90 && cells[behind] === soldier) out[count++] = behind;
  if (!ownHalf(side, row)) {
    if (col > 0 && cells[cell - 1] === soldier) out[count++] = cell - 1;
    if (col < 8 && cells[cell + 1] === soldier) out[count++] = cell + 1;
  }
  // Only when the cell is one these pieces may stand on: the palace, or the own half for elephants.
  const slot = side * 90 + cell;
  const palace = inPalace(side, col, row);
  for (const [table, code] of STEP_MOVERS) {
    if (code === XQ_ELEPHANT ? !ownHalf(side, row) : !palace) continue;
    for (let index = slot * 8, end = index + table.count[slot]; index < end; index++) {
      const at = table.list[index];
      if (cells[at] === sign * code && (table.block[index] < 0 || cells[table.block[index]] === 0)) out[count++] = at;
    }
  }
  return count;
}

const seeAttackers = new Int8Array(32);
const seeGain = new Int32Array(40);
const seeCells = new Int8Array(40);
const seePieces = new Int8Array(40);

function leastAttacker(cells: Int8Array, cell: number, side: XqSide): number {
  const count = attackersOf(cells, cell, side, seeAttackers);
  let best = -1;
  let bestValue = Infinity;
  for (let index = 0; index < count; index++) {
    const piece = cells[seeAttackers[index]];
    const value = XQ_SEE_VALUE[piece > 0 ? piece : -piece];
    if (value < bestValue) {
      bestValue = value;
      best = seeAttackers[index];
    }
  }
  return best;
}

/** Expected material of a capture after least-valuable recaptures on its cell (cannon screens change as pieces move). */
export function xqSee(state: XqBoardState, move: number): number {
  const { cells } = state;
  const from = move >> 7;
  const to = move & 127;
  const mover = cells[from];
  const victim = cells[to];
  seeGain[0] = victim === 0 ? 0 : XQ_SEE_VALUE[victim > 0 ? victim : -victim];
  let onCell = XQ_SEE_VALUE[mover > 0 ? mover : -mover];
  let removed = 0;
  seeCells[removed] = from;
  seePieces[removed++] = mover;
  cells[from] = 0;
  cells[to] = mover;
  let side: XqSide = mover > 0 ? 1 : 0;
  let depth = 1;
  for (; depth < 32; depth++) {
    const attacker = leastAttacker(cells, to, side);
    if (attacker < 0) break;
    const piece = cells[attacker];
    seeGain[depth] = onCell - seeGain[depth - 1];
    onCell = XQ_SEE_VALUE[piece > 0 ? piece : -piece];
    seeCells[removed] = attacker;
    seePieces[removed++] = piece;
    cells[attacker] = 0;
    cells[to] = piece;
    side = side === 0 ? 1 : 0;
  }
  while (--depth > 0) seeGain[depth - 1] = -Math.max(-seeGain[depth - 1], seeGain[depth]);
  cells[to] = victim;
  for (let index = removed - 1; index >= 0; index--) cells[seeCells[index]] = seePieces[index];
  return seeGain[0];
}

export { XQ_ADVISOR, XQ_CANNON, XQ_CHARIOT, XQ_ELEPHANT, XQ_GENERAL, XQ_HORSE, XQ_ROW, XQ_SOLDIER };
