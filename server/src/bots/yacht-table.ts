// ─── Yacht Dice solitaire table: the optimal expected future score of every state, read from disk once ───

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { YACHT_STATE_COUNT, stateIndex } from './yacht-states';
import type { YachtFlag } from './yacht-states';

/** Written by `npm run yacht:table`; the release build copies it with the server sources. */
export const YACHT_TABLE_PATH = fileURLToPath(new URL('./yacht-table.bin', import.meta.url));

/** Values are 16-bit counts of 1/128 point, then one byte per state holding the spread in half points. */
export const YACHT_MEAN_SCALE = 128;
export const YACHT_SPREAD_SCALE = 2;
export const YACHT_TABLE_BYTES = YACHT_STATE_COUNT * 3;

interface YachtTable {
  readonly mean: Float32Array;
  readonly spread: Float32Array;
}

let cached: YachtTable | null = null;

/** Loads the table, failing fast when the file is missing or does not match the state layout. */
export function yachtTable(): YachtTable {
  if (cached) return cached;
  const bytes = readFileSync(YACHT_TABLE_PATH);
  if (bytes.length !== YACHT_TABLE_BYTES) {
    throw new Error(`Yacht table has ${bytes.length} bytes, expected ${YACHT_TABLE_BYTES}; run npm run yacht:table.`);
  }
  const mean = new Float32Array(YACHT_STATE_COUNT);
  const spread = new Float32Array(YACHT_STATE_COUNT);
  for (let index = 0; index < YACHT_STATE_COUNT; index += 1) {
    mean[index] = bytes.readUInt16LE(index * 2) / YACHT_MEAN_SCALE;
    spread[index] = bytes[YACHT_STATE_COUNT * 2 + index] / YACHT_SPREAD_SCALE;
  }
  cached = { mean, spread };
  return cached;
}

/** Expected points a player still scores from a state under optimal solitaire play, bonuses included. */
export function yachtFutureMean(mask: number, flag: YachtFlag, subtotal: number): number {
  return yachtTable().mean[stateIndex(mask, flag, subtotal)];
}

/** Standard deviation of those points. */
export function yachtFutureSpread(mask: number, flag: YachtFlag, subtotal: number): number {
  return yachtTable().spread[stateIndex(mask, flag, subtotal)];
}
