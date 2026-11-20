// ─── Go bot move model: the fitted strengths of `go-model-weights.ts` as lookup tables ───

import { CAPTURE_BASE, FEATURE_COUNT, PATTERN_FEATURES } from './go-features';
import { GO_MODEL_FEATURES, GO_MODEL_PATTERNS, GO_MODEL_RARE_PATTERN } from './go-model-weights';

/** Log-strength of every feature id; pattern ids are canonical codes, unlisted ones take the rare-pattern value. */
const LOG_STRENGTH: Float64Array = (() => {
  const table = new Float64Array(FEATURE_COUNT);
  table.fill(GO_MODEL_RARE_PATTERN, 0, PATTERN_FEATURES);
  for (let index = 0; index + 1 < GO_MODEL_PATTERNS.length; index += 2) table[GO_MODEL_PATTERNS[index]] = GO_MODEL_PATTERNS[index + 1];
  GO_MODEL_FEATURES.forEach((value, offset) => {
    if (CAPTURE_BASE + offset < FEATURE_COUNT) table[CAPTURE_BASE + offset] = value;
  });
  return table;
})();


/** Sum of the log-strengths of a move's features. */
export function modelLogStrength(features: Int32Array, count: number): number {
  let total = 0;
  for (let index = 0; index < count; index++) total += LOG_STRENGTH[features[index]];
  return total;
}
