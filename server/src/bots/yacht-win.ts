// ─── Yacht Dice win chance: the odds of finishing ahead of rivals whose cards are public ───

/** A rival's final total as the table sees it: banked points plus the expected rest, and its spread. */
export interface YachtRival {
  readonly mean: number;
  readonly spread: number;
}

const GRID_TOP = 700;
/** The finishing totals of a rival that is done are exact; a little blur keeps the odds smooth. */
const MIN_SPREAD = 1;

/** Standard normal distribution function (Abramowitz and Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 + erf / 2 : 0.5 - erf / 2;
}

/** Seven-point Gauss-Hermite rule for a standard normal: nodes and weights. */
const NODES = [0, 1.1544053947, -1.1544053947, 2.3667594107, -2.3667594107, 3.7504397177, -3.7504397177];
const WEIGHTS = [0.4571428571, 0.2401231786, 0.2401231786, 0.0307571239, 0.0307571239, 0.0005482689, 0.0005482689];

/**
 * Returns the chance of beating every rival when one's own final total is normal with the given mean and
 * spread. Rival totals are taken as independent normals; a tie counts as a win, which at this resolution
 * changes nothing.
 */
export function yachtWinChance(rivals: readonly YachtRival[]): (mean: number, spread: number) => number {
  // Chance of beating every rival with a fixed total, per point of total.
  const beat = new Float64Array(GRID_TOP + 1).fill(1);
  for (const rival of rivals) {
    const spread = Math.max(MIN_SPREAD, rival.spread);
    for (let total = 0; total <= GRID_TOP; total += 1) beat[total] *= normalCdf((total + 0.5 - rival.mean) / spread);
  }
  const at = (total: number): number => {
    if (total <= 0) return beat[0];
    if (total >= GRID_TOP) return beat[GRID_TOP];
    const low = Math.floor(total);
    return beat[low] + (beat[low + 1] - beat[low]) * (total - low);
  };
  return (mean, spread) => {
    if (spread < 0.25) return at(mean);
    let value = 0;
    for (let index = 0; index < NODES.length; index += 1) value += WEIGHTS[index] * at(mean + NODES[index] * spread);
    return value;
  };
}
