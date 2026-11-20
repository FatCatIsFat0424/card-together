// Tuned weights of the Jungle evaluation, in the slots of `W` in jungle-eval.ts.
// Produced by scripts/jungle-tune/tune.ts (head-to-head SPSA self-play, 5000 nodes per move).

export const JUNGLE_WEIGHTS: Float64Array = Float64Array.from([
  // material, ranks 1-8
  86, 244, 149, 303, 189, 412, 580, 839,
  // advance per step, ranks 1-8
  2.7, 7, 9.4, 2.5, 13, 12.1, 14, 14.2,
  // trapped %, rat hunt, elephant fear, elephant near
  125.5, 243, 95, 33,
  // race 1-6
  2942, 1131, 378, 547, 24, 381,
  // cover, mobility, tempo, endgame %, noise, fade from
  49, 0, 15, 50, 4, 60,
]);
