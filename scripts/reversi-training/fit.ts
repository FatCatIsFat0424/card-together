// Least-squares fit of the pattern weights to labelled positions by stochastic gradient descent. Each stage
// learns from positions within `STAGE_OVERLAP` empties of its own range, which smooths neighbouring stages,
// and symmetric pattern configurations share one weight.
import {
  FEATURE_COUNT, FEATURE_TABLES, SCALE, STAGES, STAGE_SIZE, STAGE_WIDTH, featureIndices, stageOf,
} from '../../server/src/bots/reversi-eval';
import { popcount } from '../../server/src/bots/reversi-board';
import { NO_SCORE, RECORD_INTS } from './selfplay';

const STAGE_OVERLAP = 2;
/** Share of the game result in a blended label; the rest is the search score. */
const RESULT_SHARE = 0.5;

/** Training target in score units: the result, blended with the search score when there is one. */
function targetOf(records: Int32Array, base: number): number {
  const result = records[base + 4] * SCALE;
  const score = records[base + 5];
  return score === NO_SCORE ? result : RESULT_SHARE * result + (1 - RESULT_SHARE) * score;
}

export interface FitOptions {
  readonly epochs: number;
  readonly random: () => number;
  readonly log: (line: string) => void;
}

/** Weight slot shared by each stage-relative index: its symmetry class representative. */
function canonicalSlots(): Int32Array {
  const slots = new Int32Array(STAGE_SIZE);
  for (const table of FEATURE_TABLES) {
    for (let config = 0; config < table.size; config++) slots[table.offset + config] = table.offset + table.canonical[config];
  }
  return slots;
}

function stagesOf(empties: number): number[] {
  const stages: number[] = [];
  for (let stage = 0; stage < STAGES; stage++) {
    // Stage s covers empties (60 - s * width - width, 60 - s * width]; the last stage reaches down to 0.
    const high = 60 - stage * STAGE_WIDTH;
    const low = stage === STAGES - 1 ? 0 : high - STAGE_WIDTH + 1;
    if (empties >= low - STAGE_OVERLAP && empties <= high + STAGE_OVERLAP) stages.push(stage);
  }
  return stages;
}

/** Fits weights in score units to `records` (flat `RECORD_INTS` values each) and returns them quantized. */
export function fitWeights(records: Int32Array, options: FitOptions): Int16Array {
  const count = records.length / RECORD_INTS;
  const slots = canonicalSlots();
  const weights = new Float64Array(STAGES * STAGE_SIZE);
  const indices = new Int32Array(FEATURE_COUNT);
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  const holdout = Math.max(1, Math.floor(count * 0.03));
  // Shuffle once; the first `holdout` positions only measure the error.
  for (let index = count - 1; index > 0; index--) {
    const swap = Math.floor(options.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  const stageLists = Array.from({ length: 61 }, (_, empties) => stagesOf(empties));

  const holdoutError = (): number => {
    let sum = 0;
    for (let k = 0; k < holdout; k++) {
      const base = order[k] * RECORD_INTS;
      const pl = records[base];
      const ph = records[base + 1];
      const ol = records[base + 2];
      const oh = records[base + 3];
      const empties = 64 - popcount(pl | ol) - popcount(ph | oh);
      featureIndices(pl, ph, ol, oh, indices);
      const offset = stageOf(empties) * STAGE_SIZE;
      let prediction = 0;
      for (let f = 0; f < FEATURE_COUNT; f++) prediction += weights[offset + slots[indices[f]]];
      const error = targetOf(records, base) - prediction;
      sum += error * error;
    }
    return Math.sqrt(sum / holdout) / SCALE;
  };

  for (let epoch = 0; epoch < options.epochs; epoch++) {
    const rate = 0.003 * Math.pow(0.7, epoch);
    for (let k = count - 1; k > holdout; k--) {
      const swap = holdout + Math.floor(options.random() * (k - holdout + 1));
      [order[k], order[swap]] = [order[swap], order[k]];
    }
    let sum = 0;
    let samples = 0;
    for (let k = holdout; k < count; k++) {
      const base = order[k] * RECORD_INTS;
      const pl = records[base];
      const ph = records[base + 1];
      const ol = records[base + 2];
      const oh = records[base + 3];
      const empties = 64 - popcount(pl | ol) - popcount(ph | oh);
      featureIndices(pl, ph, ol, oh, indices);
      const target = targetOf(records, base);
      for (const stage of stageLists[empties]) {
        const offset = stage * STAGE_SIZE;
        let prediction = 0;
        for (let f = 0; f < FEATURE_COUNT; f++) prediction += weights[offset + slots[indices[f]]];
        const error = target - prediction;
        sum += error * error;
        samples++;
        const step = rate * error;
        for (let f = 0; f < FEATURE_COUNT; f++) weights[offset + slots[indices[f]]] += step;
      }
    }
    options.log(`epoch ${epoch + 1}: train rms ${(Math.sqrt(sum / samples) / SCALE).toFixed(2)} discs, holdout rms ${holdoutError().toFixed(2)} discs`);
  }

  const quantized = new Int16Array(STAGES * STAGE_SIZE);
  for (let stage = 0; stage < STAGES; stage++) {
    const offset = stage * STAGE_SIZE;
    for (let index = 0; index < STAGE_SIZE; index++) {
      quantized[offset + index] = Math.max(-32767, Math.min(32767, Math.round(weights[offset + slots[index]])));
    }
  }
  return quantized;
}
