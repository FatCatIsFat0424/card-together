// ─── Transposition table for the board-game alpha-beta searches (chess, xiangqi) ───
//
// Two-slot buckets in flat typed arrays, addressed by the low word of a 64-bit Zobrist key and verified by the
// high word. Tables live at module level so a worker allocates them once; every search starts a new generation and
// ignores entries from earlier ones, which keeps a depth-limited search reproducible whatever ran before it.

/** The stored score is exact, a lower bound (fail high), or an upper bound (fail low). */
export const TT_EXACT = 1;
export const TT_LOWER = 2;
export const TT_UPPER = 3;

/** No move stored. */
export const TT_NO_MOVE = 0;

export interface TranspositionTable {
  /** High key word per slot. */
  readonly keys: Int32Array;
  /** `move & 0xffff | depth << 16 | bound << 24 | generation << 26` per slot. */
  readonly data: Int32Array;
  readonly scores: Int32Array;
  /** Static evaluation of the position, for pruning decisions. */
  readonly evals: Int32Array;
  /** Slot mask; buckets are even slot pairs. */
  readonly mask: number;
  generation: number;
}

/** A table of `2 ** bits` slots (16 bytes each). */
export function createTranspositionTable(bits: number): TranspositionTable {
  const size = 1 << bits;
  return {
    keys: new Int32Array(size), data: new Int32Array(size), scores: new Int32Array(size), evals: new Int32Array(size),
    mask: size - 1, generation: 0,
  };
}

/** Starts a search: entries written before are treated as absent. */
export function ttNewSearch(table: TranspositionTable): void {
  table.generation = (table.generation % 63) + 1;
}

/** Slot of the entry for the key, or −1 when it is absent or stale. */
export function ttProbe(table: TranspositionTable, low: number, high: number): number {
  const slot = low & table.mask & ~1;
  const generation = table.generation;
  if (table.keys[slot] === high && (table.data[slot] >>> 26) === generation && table.data[slot] !== 0) return slot;
  const other = slot + 1;
  if (table.keys[other] === high && (table.data[other] >>> 26) === generation && table.data[other] !== 0) return other;
  return -1;
}

export const ttMove = (table: TranspositionTable, slot: number): number => table.data[slot] & 0xffff;
export const ttDepth = (table: TranspositionTable, slot: number): number => (table.data[slot] >>> 16) & 0xff;
export const ttBound = (table: TranspositionTable, slot: number): number => (table.data[slot] >>> 24) & 3;

/**
 * Stores an entry, replacing the same key, then a stale slot, then the shallower of the bucket. A missing move
 * keeps the one already stored for the key.
 */
export function ttStore(
  table: TranspositionTable, low: number, high: number, depth: number, bound: number, move: number, score: number,
  evaluation: number,
): void {
  const first = low & table.mask & ~1;
  const generation = table.generation;
  let slot = -1;
  for (let index = first; index <= first + 1; index++) {
    if (table.keys[index] === high && (table.data[index] >>> 26) === generation) {
      slot = index;
      break;
    }
  }
  if (slot < 0) {
    if ((table.data[first] >>> 26) !== generation) slot = first;
    else if ((table.data[first + 1] >>> 26) !== generation) slot = first + 1;
    else slot = ((table.data[first] >>> 16) & 0xff) <= ((table.data[first + 1] >>> 16) & 0xff) ? first : first + 1;
  } else if (move === TT_NO_MOVE) {
    move = table.data[slot] & 0xffff;
  }
  table.keys[slot] = high;
  table.data[slot] = (move & 0xffff) | (Math.max(0, Math.min(depth, 255)) << 16) | (bound << 24) | (generation << 26);
  table.scores[slot] = score;
  table.evals[slot] = evaluation;
}

/** Mate scores are stored relative to the node, not the root, so a transposition at another ply reads them right. */
export function ttScoreToStore(score: number, ply: number, mateBound: number): number {
  if (score >= mateBound) return score + ply;
  if (score <= -mateBound) return score - ply;
  return score;
}

export function ttScoreFromStore(score: number, ply: number, mateBound: number): number {
  if (score >= mateBound) return score - ply;
  if (score <= -mateBound) return score + ply;
  return score;
}
