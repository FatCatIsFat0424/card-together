// Trick estimate for one side's contract on a fully known deal, fitted by least squares to double-dummy
// results of random deals (scripts/bridge-trick-model). Bidding simulations apply it to sampled deals,
// which is far cheaper than solving each one.
//
// Deals use the solver layout: `hands[seat * 4 + suit]` rank masks, seats clockwise from N, suits from clubs,
// strain 4 for no-trump.

export const NT_STRAIN = 4;

const ACE = 1 << 12;
const KING = 1 << 11;
const QUEEN = 1 << 10;
const JACK = 1 << 9;

function bitCount(mask: number): number {
  let count = 0;
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++;
  return count;
}

function points(mask: number): number {
  return ((mask & ACE) ? 4 : 0) + ((mask & KING) ? 3 : 0) + ((mask & QUEEN) ? 2 : 0) + ((mask & JACK) ? 1 : 0);
}

/** A, Kx, Qxx, or Jxxx. */
function stops(mask: number): boolean {
  const length = bitCount(mask);
  return (mask & ACE) !== 0 || ((mask & KING) !== 0 && length >= 2) || ((mask & QUEEN) !== 0 && length >= 3)
    || ((mask & JACK) !== 0 && length >= 4);
}

/** Feature names in coefficient order; the first coefficient is the intercept. */
export const SUIT_FEATURES = ['hcp', 'shortFit', 'longFit', 'shortHand', 'longHand', 'opponentTrumps', 'controls', 'sideLength'] as const;
export const NT_FEATURES = ['hcp', 'longSuit', 'unstopped', 'opponentLength', 'aces'] as const;

/** Features of `side` (0 = N-S, 1 = E-W) declaring `strain`. */
export function trickFeatures(hands: Int32Array, side: number, strain: number): number[] {
  const first = side;
  const second = side + 2;
  const left = 1 - side;
  const right = 3 - side;
  let hcp = 0;
  let aces = 0;
  let kings = 0;
  for (let suit = 0; suit < 4; suit++) {
    for (const seat of [first, second]) {
      const mask = hands[seat * 4 + suit];
      hcp += points(mask);
      if (mask & ACE) aces++;
      if (mask & KING) kings++;
    }
  }
  const length = (seat: number, suit: number): number => bitCount(hands[seat * 4 + suit]);
  if (strain === NT_STRAIN) {
    let longSuit = 0;
    let unstopped = 0;
    let opponentLength = 0;
    for (let suit = 0; suit < 4; suit++) {
      longSuit = Math.max(longSuit, length(first, suit) + length(second, suit));
      if (!stops(hands[first * 4 + suit]) && !stops(hands[second * 4 + suit])) {
        unstopped++;
        opponentLength = Math.max(opponentLength, length(left, suit), length(right, suit));
      }
    }
    return [hcp, Math.max(0, longSuit - 6), unstopped, Math.max(0, opponentLength - 3), aces];
  }
  const trumps = [length(first, strain), length(second, strain)];
  const total = trumps[0] + trumps[1];
  const [shortSeat, longSeat] = trumps[0] <= trumps[1] ? [first, second] : [second, first];
  // Short side suits ruff only while that hand still holds trumps.
  const shortness = (seat: number): number => {
    const own = length(seat, strain);
    if (own < 2) return 0;
    let value = 0;
    for (let suit = 0; suit < 4; suit++) if (suit !== strain) value += Math.max(0, 3 - length(seat, suit));
    return Math.min(value, own);
  };
  let sideLength = 0;
  for (let suit = 0; suit < 4; suit++) {
    if (suit !== strain) sideLength = Math.max(sideLength, length(first, suit) + length(second, suit));
  }
  return [
    hcp, Math.max(0, 8 - total), Math.max(0, total - 8), shortness(shortSeat), shortness(longSeat),
    Math.max(length(left, strain), length(right, strain)), aces * 2 + kings, Math.max(0, sideLength - 6),
  ];
}

interface TrickModel {
  readonly coefficients: readonly number[];
  /** Standard deviation of double-dummy tricks around the estimate. */
  readonly spread: number;
}

// Fitted by scripts/bridge-trick-model/fit.ts on 448 random deals (held-out Brier score of make predictions:
// suits 0.061, no-trump 0.073, against 0.074 and 0.101 for the points-and-fit formula); regenerate rather than edit.
const SUIT_MODEL: TrickModel = {
  coefficients: [1.6269, 0.3009, -0.7991, 0.2922, 0.0433, 0.3295, -0.4001, 0.214, -0.1274], spread: 1.059,
};
const NT_MODEL: TrickModel = { coefficients: [-2.8008, 0.42, 0.0072, 0.5454, -0.6047, 0.3553], spread: 1.1464 };

/** Expected double-dummy tricks for the side and its spread. */
export function estimateTricks(hands: Int32Array, side: number, strain: number): { readonly mean: number; readonly spread: number } {
  const model = strain === NT_STRAIN ? NT_MODEL : SUIT_MODEL;
  const features = trickFeatures(hands, side, strain);
  const mean = features.reduce((sum, value, index) => sum + value * model.coefficients[index + 1], model.coefficients[0]);
  return { mean, spread: model.spread };
}

/** Standard normal cumulative distribution (Abramowitz-Stegun 7.1.26, error below 1e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Chance that the side takes at least `6 + level` tricks in `strain` on this deal. */
export function makeChance(hands: Int32Array, side: number, strain: number, level: number): number {
  const { mean, spread } = estimateTricks(hands, side, strain);
  return normalCdf((mean - (6 + level) + 0.5) / spread);
}
