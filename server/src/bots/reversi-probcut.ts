// Written by `npm run reversi:probcut` (scripts/reversi-training/probcut.ts); do not edit by hand.

/** Deep searches from this depth try a shallow search first. */
export const PROBCUT_MIN_DEPTH = 3;
/** Deeper searches reuse the parameters of this depth. */
export const PROBCUT_MAX_DEPTH = 11;
/** Game stages by empty squares: bucket `min(BUCKETS - 1, floor((60 - empties) / WIDTH))`. */
export const PROBCUT_BUCKETS = 5;
export const PROBCUT_BUCKET_WIDTH = 10;
/** Per bucket and depth 0..MAX: slope, intercept, and residual deviation (score units) of deep on shallow. */
export const PROBCUT: readonly number[] = [
  1, 0, 0, 1, 0, 0, 1, 0, 0, 0.953, 3.4, 72.3, 0.952, 9.2, 65.4, 0.912, 10.2, 89.6, 0.954, 19.3, 82, 0.977, -2.9, 73.7, 1.005, 11.9, 73.9, 0.994, -8.9, 81.3, 1.013, 13.4, 80.5, 1.011, -11.1, 68.7,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 0.975, -11.3, 107.8, 0.98, 2.6, 88.3, 0.955, -3.1, 124.3, 0.967, 4.2, 109.7, 0.979, 12.8, 98, 0.977, 8.3, 99.9, 0.973, 21.1, 106.9, 0.986, 9.1, 107.4, 0.998, 13, 95.6,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 0.995, -11, 122.2, 0.985, -12.1, 102, 0.974, -7.6, 154.4, 0.968, -7.9, 129.5, 0.973, 2.8, 120.7, 0.972, 3.7, 111.2, 0.959, -3.5, 138.6, 0.969, 8.2, 118.8, 0.985, -9.6, 101.4,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 0.996, -14.3, 127.9, 0.996, 2.8, 117.4, 0.992, -10.2, 152.3, 1.007, 10.5, 141.5, 0.988, 9.1, 122.2, 1.006, 9, 114.8, 0.988, -2.3, 138.9, 1.008, 18.5, 124.5, 1.003, -11.1, 123.4,
  1, 0, 0, 1, 0, 0, 1, 0, 0, 1.033, -23.9, 123.4, 1.01, 7, 131.7, 1.035, -11, 163.6, 1.021, 21.2, 154.3, 1.015, 15.1, 150.8, 1.024, 16.3, 140.3, 0.846, -5.2, 383.4, 0.726, 0.6, 434.9, 0.585, 5.9, 470.8,
];
