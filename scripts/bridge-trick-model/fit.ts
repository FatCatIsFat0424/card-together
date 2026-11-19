// Fits the Bridge trick estimator to generate.ts output and prints the coefficients for
// server/src/bots/bridge-tricks.ts, with a held-out comparison against the points-and-fit formula the
// descriptive bids still use (bridge-bidding.ts).
// Usage: tsx scripts/bridge-trick-model/fit.ts <deals.jsonl>...
import { readFileSync } from 'node:fs';
import { normalCdf, NT_STRAIN, trickFeatures } from '../../server/src/bots/bridge-tricks';

interface Row {
  readonly features: number[];
  readonly tricks: number;
}

interface Fit {
  readonly coefficients: number[];
  readonly spread: number;
}

/** Ordinary least squares with an intercept, by Gaussian elimination on the normal equations. */
function leastSquares(rows: readonly Row[]): Fit {
  const size = rows[0].features.length + 1;
  const matrix = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0));
  for (const row of rows) {
    const x = [1, ...row.features];
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][size] += x[i] * row.tricks;
    }
  }
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
    for (let row = 0; row < size; row++) {
      if (row === column || matrix[column][column] === 0) continue;
      const factor = matrix[row][column] / matrix[column][column];
      for (let k = column; k <= size; k++) matrix[row][k] -= factor * matrix[column][k];
    }
  }
  const coefficients = matrix.map((row, index) => row[size] / row[index]);
  const residuals = rows.map((row) => row.tricks - predict(coefficients, row.features));
  const spread = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, rows.length - size));
  return { coefficients, spread };
}

function predict(coefficients: readonly number[], features: readonly number[]): number {
  return features.reduce((sum, value, index) => sum + value * coefficients[index + 1], coefficients[0]);
}

/** Mean squared error of make predictions for one- to four-level contracts. */
function brier(rows: readonly Row[], chance: (row: Row, level: number) => number): number {
  let total = 0;
  let count = 0;
  for (const row of rows) {
    for (let level = 1; level <= 4; level++) {
      const made = row.tricks >= 6 + level ? 1 : 0;
      total += (chance(row, level) - made) ** 2;
      count++;
    }
  }
  return total / count;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

const deals = process.argv.slice(2).flatMap((path) => readFileSync(path, 'utf8').split('\n').filter(Boolean))
  .map((line) => JSON.parse(line) as { hands: number[]; tricks: number[][] });
if (deals.length === 0) {
  console.error('Usage: fit.ts <deals.jsonl>...');
  process.exit(1);
}
const full = { suit: [] as Row[], nt: [] as Row[] };
for (const deal of deals) {
  const hands = Int32Array.from(deal.hands);
  for (const side of [0, 1]) {
    for (const strain of [0, 1, 2, 3, NT_STRAIN]) {
      const tricks = deal.tricks[side][strain];
      const features = trickFeatures(hands, side, strain);
      (strain === NT_STRAIN ? full.nt : full.suit).push({ features, tricks });
    }
  }
}

// The points-and-fit formula in bridge-bidding.ts, for comparison; features[0] is points, [1] and [2] the fit.
const FIT_TRICKS = [[4, -4.4], [5, -3.2], [6, -2], [7, -0.9], [8, 0], [9, 0.7], [10, 1.15], [11, 1.5], [12, 1.8], [13, 2]];
function fitAdjustment(fit: number): number {
  if (fit <= 4) return FIT_TRICKS[0][1];
  for (let index = 1; index < FIT_TRICKS.length; index++) {
    const [length, value] = FIT_TRICKS[index];
    if (fit <= length) {
      const [previousLength, previousValue] = FIT_TRICKS[index - 1];
      return previousValue + (value - previousValue) * (fit - previousLength) / (length - previousLength);
    }
  }
  return 2;
}
function previousChance(row: Row, level: number, nt: boolean): number {
  const points = row.features[0];
  const fit = nt ? 0 : 8 - row.features[1] + row.features[2];
  const expected = nt ? 6.7 + 0.29 * (points - 20) : 8 + 0.24 * (points - 20) + fitAdjustment(fit);
  const z = (expected - (6 + level) + 0.5) / (nt ? 1.6 : 1.15);
  return 1 / (1 + Math.exp(-1.702 * z));
}

for (const kind of ['suit', 'nt'] as const) {
  const split = Math.floor(full[kind].length * 0.8);
  const nt = kind === 'nt';
  const fit = leastSquares(full[kind].slice(0, split));
  const chance = (row: Row, level: number): number => normalCdf((predict(fit.coefficients, row.features) - (6 + level) + 0.5) / fit.spread);
  const heldOut = full[kind].slice(split);
  console.log(`${kind}: ${full[kind].length} rows`);
  console.log(`  model ${JSON.stringify({ coefficients: fit.coefficients.map(round), spread: round(fit.spread) })}`);
  console.log(`  held-out Brier: points-and-fit ${round(brier(heldOut, (row, level) => previousChance(row, level, nt)))}, model ${round(brier(heldOut, chance))}`);
}
