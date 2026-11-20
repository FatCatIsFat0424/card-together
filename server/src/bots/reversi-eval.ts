// ─── Reversi evaluation: edge, corner, line, and diagonal patterns plus mobility, weighted per game stage ───
//
// Every pattern is a list of cells read as a base-3 number (empty, own disc, opponent disc), and each of its
// symmetric images on the board shares one weight table. Weights are fitted offline by
// `npm run reversi:train` (scripts/reversi-training) and stored compactly in `reversi-weights.bin`: only one
// configuration per symmetry class, as gzip-compressed 16-bit integers.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { SYMMETRIES, mobility, popcount } from './reversi-board';

/** Score units per disc: evaluations and solved results share this scale. */
export const SCALE = 32;

/** Positions are grouped into stages by empty squares; each stage has its own weights. */
export const STAGE_WIDTH = 5;
export const STAGES = 12;
export const stageOf = (empties: number): number => Math.min(STAGES - 1, Math.max(0, Math.floor((60 - empties) / STAGE_WIDTH)));

interface PatternType {
  readonly name: string;
  /** Cells of one instance in the top-left orientation; the other instances are its symmetric images. */
  readonly cells: readonly number[];
}

/** Cell index from a column letter offset and a row, top-left origin. */
const at = (col: number, row: number): number => row * 8 + col;

const PATTERN_TYPES: readonly PatternType[] = [
  { name: 'corner3x3', cells: [at(0, 0), at(1, 0), at(2, 0), at(0, 1), at(1, 1), at(2, 1), at(0, 2), at(1, 2), at(2, 2)] },
  { name: 'edge2x', cells: [at(1, 1), ...[0, 1, 2, 3, 4, 5, 6, 7].map((c) => at(c, 0)), at(6, 1)] },
  { name: 'corner2x5', cells: [0, 1, 2, 3, 4].flatMap((c) => [at(c, 0), at(c, 1)]) },
  { name: 'line2', cells: [0, 1, 2, 3, 4, 5, 6, 7].map((c) => at(c, 1)) },
  { name: 'line3', cells: [0, 1, 2, 3, 4, 5, 6, 7].map((c) => at(c, 2)) },
  { name: 'line4', cells: [0, 1, 2, 3, 4, 5, 6, 7].map((c) => at(c, 3)) },
  { name: 'diag8', cells: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => at(i, i)) },
  { name: 'diag7', cells: [0, 1, 2, 3, 4, 5, 6].map((i) => at(i + 1, i)) },
  { name: 'diag6', cells: [0, 1, 2, 3, 4, 5].map((i) => at(i + 2, i)) },
  { name: 'diag5', cells: [0, 1, 2, 3, 4].map((i) => at(i + 3, i)) },
  { name: 'diag4', cells: [0, 1, 2, 3].map((i) => at(i + 4, i)) },
];

/** Mobility counts above this share the last weight. */
const MOBILITY_CAP = 24;

/** Feature tables in weight order: the patterns, then own and opponent mobility, then empties parity. */
export interface FeatureTable {
  readonly name: string;
  /** Configurations (3^cells for a pattern) */
  readonly size: number;
  /** Offset of the table inside one stage's weights */
  readonly offset: number;
  /** For each configuration, its symmetry class representative (the smallest equivalent configuration) */
  readonly canonical: Int32Array;
}

const POW3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683, 59049];

function patternInstances(cells: readonly number[]): { instances: number[][]; selfMaps: number[][] } {
  const instances: number[][] = [];
  const selfMaps: number[][] = [];
  const key = (list: readonly number[]): string => [...list].sort((a, b) => a - b).join(',');
  const baseKey = key(cells);
  for (const map of SYMMETRIES) {
    const image = cells.map((cell) => map[cell]);
    if (key(image) === baseKey) selfMaps.push(image.map((cell) => cells.indexOf(cell)));
    if (!instances.some((instance) => key(instance) === key(image))) instances.push(image);
  }
  return { instances, selfMaps };
}

/** Base-3 configuration of a pattern from per-cell states, first cell most significant. */
const configOf = (states: readonly number[]): number => states.reduce((index, state) => index * 3 + state, 0);

function canonicalMap(length: number, selfMaps: readonly number[][]): Int32Array {
  const size = POW3[length];
  const canonical = new Int32Array(size);
  const states = new Array<number>(length).fill(0);
  const permuted = new Array<number>(length).fill(0);
  for (let index = 0; index < size; index++) {
    let rest = index;
    for (let k = length - 1; k >= 0; k--) {
      states[k] = rest % 3;
      rest = Math.floor(rest / 3);
    }
    let best = index;
    for (const map of selfMaps) {
      // Position k of the instance moves to position map[k].
      for (let k = 0; k < length; k++) permuted[map[k]] = states[k];
      best = Math.min(best, configOf(permuted));
    }
    canonical[index] = best;
  }
  return canonical;
}

function identityMap(size: number): Int32Array {
  return Int32Array.from({ length: size }, (_, index) => index);
}

/** Every feature table, the cells of every pattern instance, and the table of each instance. */
const LAYOUT = (() => {
  const tables: FeatureTable[] = [];
  const instanceCells: number[] = [];
  const instanceStart: number[] = [];
  const instanceLength: number[] = [];
  const instanceOffset: number[] = [];
  let offset = 0;
  for (const type of PATTERN_TYPES) {
    const { instances, selfMaps } = patternInstances(type.cells);
    const size = POW3[type.cells.length];
    tables.push({ name: type.name, size, offset, canonical: canonicalMap(type.cells.length, selfMaps) });
    for (const instance of instances) {
      instanceStart.push(instanceCells.length);
      instanceLength.push(instance.length);
      instanceOffset.push(offset);
      instanceCells.push(...instance);
    }
    offset += size;
  }
  const mobilityOwn = offset;
  tables.push({ name: 'mobility', size: MOBILITY_CAP + 1, offset, canonical: identityMap(MOBILITY_CAP + 1) });
  offset += MOBILITY_CAP + 1;
  const mobilityTheirs = offset;
  tables.push({ name: 'opponent-mobility', size: MOBILITY_CAP + 1, offset, canonical: identityMap(MOBILITY_CAP + 1) });
  offset += MOBILITY_CAP + 1;
  const parity = offset;
  tables.push({ name: 'parity', size: 2, offset, canonical: identityMap(2) });
  offset += 2;
  return {
    tables,
    stageSize: offset,
    cells: Int8Array.from(instanceCells),
    start: Int16Array.from(instanceStart),
    length: Int8Array.from(instanceLength),
    offset: Int32Array.from(instanceOffset),
    mobilityOwn,
    mobilityTheirs,
    parity,
  };
})();

export const FEATURE_TABLES: readonly FeatureTable[] = LAYOUT.tables;
/** Weights per stage; the full table is `STAGES * STAGE_SIZE`. */
export const STAGE_SIZE = LAYOUT.stageSize;
/** Active features per position: one per pattern instance, two mobility counts, and parity. */
export const FEATURE_COUNT = LAYOUT.start.length + 3;

/** Pattern memberships of every cell: instance and base-3 place value, `MEMBER_START[cell]` onwards. */
const MEMBERS = (() => {
  const start = new Int16Array(65);
  const instance: number[] = [];
  const power: number[] = [];
  for (let cell = 0; cell < 64; cell++) {
    start[cell] = instance.length;
    for (let k = 0; k < LAYOUT.start.length; k++) {
      const from = LAYOUT.start[k];
      const length = LAYOUT.length[k];
      for (let position = 0; position < length; position++) {
        if (LAYOUT.cells[from + position] !== cell) continue;
        instance.push(k);
        power.push(POW3[length - 1 - position]);
      }
    }
  }
  start[64] = instance.length;
  return { start, instance: Int16Array.from(instance), power: Int32Array.from(power) };
})();

/**
 * Writes the weight index (within one stage) of every active feature of the position, side to move first,
 * into `target[0 .. FEATURE_COUNT)`. Shared by the evaluation and the offline fitting. Each pattern reads its
 * cells as base-3 digits, first cell most significant; only occupied cells add to the configuration.
 */
export function featureIndices(pl: number, ph: number, ol: number, oh: number, target: Int32Array): void {
  const count = LAYOUT.start.length;
  const offsets = LAYOUT.offset;
  for (let k = 0; k < count; k++) target[k] = offsets[k];
  const { start, instance, power } = MEMBERS;
  for (let half = 0; half < 4; half++) {
    let bits = half === 0 ? pl : half === 1 ? ph : half === 2 ? ol : oh;
    const base = half & 1 ? 32 : 0;
    const shift = half >> 1;
    while (bits !== 0) {
      const cell = base + 31 - Math.clz32(bits & -bits);
      bits &= bits - 1;
      const end = start[cell + 1];
      for (let m = start[cell]; m < end; m++) target[instance[m]] += power[m] << shift;
    }
  }
  target[count] = LAYOUT.mobilityOwn + Math.min(MOBILITY_CAP, mobility(pl, ph, ol, oh));
  target[count + 1] = LAYOUT.mobilityTheirs + Math.min(MOBILITY_CAP, mobility(ol, oh, pl, ph));
  const empties = 64 - popcount(pl | ol) - popcount(ph | oh);
  target[count + 2] = LAYOUT.parity + (empties & 1);
}

/** Written by `npm run reversi:train`; the release build copies it with the server sources. */
export const REVERSI_WEIGHTS_PATH = fileURLToPath(new URL('./reversi-weights.bin', import.meta.url));

/** Canonical configurations of every table, in storage order. */
function storedSlots(): Int32Array {
  const slots: number[] = [];
  for (const table of FEATURE_TABLES) {
    for (let config = 0; config < table.size; config++) if (table.canonical[config] === config) slots.push(table.offset + config);
  }
  return Int32Array.from(slots);
}

/** Packs full per-stage weights (score units) into the stored form: canonical slots only, gzip-compressed. */
export function encodeWeights(weights: Int16Array, gzip: (data: Uint8Array) => Uint8Array): Uint8Array {
  if (weights.length !== STAGES * STAGE_SIZE) throw new Error('Unexpected weight count.');
  const slots = storedSlots();
  const packed = new Int16Array(STAGES * slots.length);
  for (let stage = 0; stage < STAGES; stage++) {
    for (let k = 0; k < slots.length; k++) packed[stage * slots.length + k] = weights[stage * STAGE_SIZE + slots[k]];
  }
  return gzip(new Uint8Array(packed.buffer));
}

/** Expands stored weights to full per-stage tables, failing fast when they do not match the layout. */
export function decodeWeights(stored: Uint8Array): Int16Array {
  const raw = gunzipSync(stored);
  const slots = storedSlots();
  if (raw.length !== STAGES * slots.length * 2) {
    throw new Error(`Reversi weights have ${raw.length} bytes, expected ${STAGES * slots.length * 2}; run npm run reversi:train.`);
  }
  const packed = new Int16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const weights = new Int16Array(STAGES * STAGE_SIZE);
  const slotOfOffset = new Int32Array(STAGE_SIZE).fill(-1);
  slots.forEach((slot, k) => {
    slotOfOffset[slot] = k;
  });
  for (const table of FEATURE_TABLES) {
    for (let config = 0; config < table.size; config++) {
      const k = slotOfOffset[table.offset + table.canonical[config]];
      for (let stage = 0; stage < STAGES; stage++) {
        weights[stage * STAGE_SIZE + table.offset + config] = packed[stage * slots.length + k];
      }
    }
  }
  return weights;
}

let loaded: Int16Array | null = null;

/** The fitted weights, read from disk once per thread. */
export function evaluationWeights(): Int16Array {
  loaded ??= decodeWeights(readFileSync(REVERSI_WEIGHTS_PATH));
  return loaded;
}

/** Replaces the weights for this thread (offline fitting evaluates candidate weights without a file). */
export function useEvaluationWeights(weights: Int16Array): void {
  if (weights.length !== STAGES * STAGE_SIZE) throw new Error('Unexpected weight count.');
  loaded = weights;
}

const indices = new Int32Array(FEATURE_COUNT);

/** Heuristic score for the side to move, in score units (`SCALE` per disc), kept inside the solved range. */
export function evaluate(pl: number, ph: number, ol: number, oh: number, empties: number): number {
  const weights = loaded ?? evaluationWeights();
  featureIndices(pl, ph, ol, oh, indices);
  const base = stageOf(empties) * STAGE_SIZE;
  let score = 0;
  for (let k = 0; k < FEATURE_COUNT; k++) score += weights[base + indices[k]];
  const limit = 64 * SCALE - 1;
  return score > limit ? limit : score < -limit ? -limit : score;
}
