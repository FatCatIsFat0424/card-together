// Tuned weights of the Chinese checkers evaluation, in the slots of `CC_W` in chinesecheckers-search.ts.
// Chosen by solo race speed and self-play against the previous bot; see scripts/chinesecheckers-tune.

export const CHINESE_CHECKERS_WEIGHTS: Float64Array = Float64Array.from([
  // straggler (per squared row), drift (per hole off the line), hop, cohesion
  0.02, 0.075, 0.3, 0.1,
  // order cohesion, backtrack, noise, follow-up
  0.2, 0.6, 0.02, 0.45,
]);
