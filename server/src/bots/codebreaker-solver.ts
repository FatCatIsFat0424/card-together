import { CB_SLOTS, cbAllCodes, cbSymbolCount } from '@shared/rules/codebreaker';
import type { CbCode, CbVariant } from '@shared/rules/codebreaker';

// Exact tools for Code Breaker. Every code of a variant is indexed once; the feedback of any guess against any
// code is two table lookups, so a whole guess pool can be scored against every remaining candidate.

/** Feedback keys are `exact * 5 + partial`; this is the winning one (four exact, none partial). */
export const SOLVED_KEY = CB_SLOTS * 5;
const KEYS = SOLVED_KEY + 1;

/** Equal nibbles of two 16-bit packed codes, by their xor. */
const EXACT_MATCHES = Uint8Array.from({ length: 1 << 16 }, (_, xor) => {
  let count = 0;
  for (let slot = 0; slot < CB_SLOTS; slot++) if (((xor >> (slot * 4)) & 15) === 0) count++;
  return count;
});

export interface CodeSpace {
  readonly variant: CbVariant;
  readonly codes: readonly CbCode[];
  readonly packed: Int32Array;
  readonly multiset: Uint8Array;
  readonly multisets: number;
  /** Symbols shared by two multisets, row-major */
  readonly common: Uint8Array;
  readonly indexOf: ReadonlyMap<number, number>;
}

const packCode = (code: CbCode): number => code[0] | (code[1] << 4) | (code[2] << 8) | (code[3] << 12);

const spaces = new Map<CbVariant, CodeSpace>();

/** The indexed codes of a variant, built on first use. */
export function codeSpace(variant: CbVariant): CodeSpace {
  const cached = spaces.get(variant);
  if (cached) return cached;
  const codes = cbAllCodes(variant);
  const symbols = cbSymbolCount(variant);
  const countsOf = (code: CbCode): number[] => {
    const counts = new Array<number>(symbols).fill(0);
    for (const symbol of code) counts[symbol]++;
    return counts;
  };
  const ids = new Map<string, number>();
  const vectors: number[][] = [];
  const multiset = new Uint8Array(codes.length);
  codes.forEach((code, index) => {
    const counts = countsOf(code);
    const key = counts.join();
    let id = ids.get(key);
    if (id === undefined) {
      id = vectors.length;
      ids.set(key, id);
      vectors.push(counts);
    }
    multiset[index] = id;
  });
  const common = new Uint8Array(vectors.length * vectors.length);
  vectors.forEach((a, x) => vectors.forEach((b, y) => {
    common[x * vectors.length + y] = a.reduce((sum, count, symbol) => sum + Math.min(count, b[symbol]), 0);
  }));
  const packed = Int32Array.from(codes.map(packCode));
  const space: CodeSpace = {
    variant, codes, packed, multiset, multisets: vectors.length, common,
    indexOf: new Map(Array.from(packed, (value, index) => [value, index] as const)),
  };
  spaces.set(variant, space);
  return space;
}

/** Feedback key of `guess` against `secret` (both code indices). */
export function feedbackKey(space: CodeSpace, guess: number, secret: number): number {
  const exact = EXACT_MATCHES[space.packed[guess] ^ space.packed[secret]];
  return exact * 5 + space.common[space.multiset[guess] * space.multisets + space.multiset[secret]] - exact;
}

/** Index of a code in the space, or -1 when it is not one. */
export function indexOfCode(space: CodeSpace, code: CbCode): number {
  return space.indexOf.get(packCode(code)) ?? -1;
}

/** Indices of the codes that would have given exactly the feedback seen for each guess. */
export function consistentIndices(space: CodeSpace, known: readonly { code: CbCode; exact: number; partial: number }[]): Int32Array {
  const guesses = known.map((entry) => indexOfCode(space, entry.code));
  const keys = known.map((entry) => entry.exact * 5 + entry.partial);
  const kept: number[] = [];
  for (let secret = 0; secret < space.codes.length; secret++) {
    let fits = true;
    for (let step = 0; step < guesses.length && fits; step++) {
      fits = guesses[step] >= 0 && feedbackKey(space, guesses[step], secret) === keys[step];
    }
    if (fits) kept.push(secret);
  }
  return Int32Array.from(kept);
}

/**
 * Expected guesses still needed from a candidate set of this size, counting the next guess, under good play
 * (log-linear between the knots; fitted to the exact solver's play by `scripts/codebreaker-openings.ts`).
 */
const FINISH_KNOTS: Readonly<Record<CbVariant, readonly (readonly [number, number])[]>> = {
  digits: [[1, 1], [2, 1.5], [4, 1.8], [8, 2.07], [16, 2.37], [32, 2.69], [64, 3.0], [128, 3.3], [256, 3.65], [512, 3.95], [1024, 4.35], [5040, 5.2]],
  colors: [[1, 1], [2, 1.5], [4, 1.76], [8, 2.0], [16, 2.4], [32, 2.68], [64, 2.95], [128, 3.25], [256, 3.52], [1296, 4.3]],
};

const finishTables = new Map<CbVariant, Float64Array>();

function finishTable(variant: CbVariant): Float64Array {
  const cached = finishTables.get(variant);
  if (cached) return cached;
  const knots = FINISH_KNOTS[variant];
  const size = variant === 'digits' ? 5040 : 1296;
  const table = new Float64Array(size + 1);
  for (let n = 1; n <= size; n++) {
    let segment = 1;
    while (segment < knots.length - 1 && n > knots[segment][0]) segment++;
    const [n0, v0] = knots[segment - 1];
    const [n1, v1] = knots[segment];
    const t = Math.min(1, Math.max(0, (Math.log(n) - Math.log(n0)) / (Math.log(n1) - Math.log(n0))));
    table[n] = v0 + (v1 - v0) * t;
  }
  finishTables.set(variant, table);
  return table;
}

/** Expected guesses from a set of `n` candidates under the fitted finish curve. */
export function finishEstimate(variant: CbVariant, n: number): number {
  return finishTable(variant)[Math.min(n, finishTable(variant).length - 1)];
}

const bucketCounts = new Int32Array(KEYS);

/** Candidate sets larger than this are scored on an evenly spaced sample of them. */
const SCORING_SAMPLE = 450;

/**
 * Estimated total guesses from here if `guess` is played against the candidates: this guess plus the finish
 * estimate of every bucket it leaves, averaged over the candidates. `scale` stretches bucket sizes when the
 * candidates passed in are a sample of a larger set.
 */
export function guessCost(space: CodeSpace, guess: number, candidates: Int32Array, finish: Float64Array, scale = 1): number {
  bucketCounts.fill(0);
  for (let i = 0; i < candidates.length; i++) bucketCounts[feedbackKey(space, guess, candidates[i])]++;
  let cost = 0;
  for (let key = 0; key < SOLVED_KEY; key++) {
    const size = bucketCounts[key];
    if (size > 0) cost += size * finish[Math.min(finish.length - 1, Math.round(size * scale))];
  }
  return 1 + cost / candidates.length;
}

/** Ordered by cost: the `count` best guesses of the whole space by `guessCost`, candidates winning ties. */
export function bestGuesses(space: CodeSpace, candidates: Int32Array, count: number): { guess: number; cost: number }[] {
  const finish = finishTable(space.variant);
  const member = new Uint8Array(space.codes.length);
  for (let i = 0; i < candidates.length; i++) member[candidates[i]] = 1;
  let targets = candidates;
  if (candidates.length > SCORING_SAMPLE) {
    targets = new Int32Array(SCORING_SAMPLE);
    for (let i = 0; i < SCORING_SAMPLE; i++) targets[i] = candidates[Math.floor((i * candidates.length) / SCORING_SAMPLE)];
  }
  const scale = candidates.length / targets.length;
  const scored: { guess: number; cost: number }[] = [];
  for (let guess = 0; guess < space.codes.length; guess++) {
    // A guess that is itself a candidate may win outright; the finish curve already prices that bucket at zero.
    scored.push({ guess, cost: guessCost(space, guess, targets, finish, scale) - (member[guess] ? 1e-9 : 0) });
  }
  scored.sort((a, b) => a.cost - b.cost || a.guess - b.guess);
  return scored.slice(0, count);
}

/** Time limit shared by the solver's recursive searches. */
export interface SolveLimit {
  readonly expired: () => boolean;
}

export const NO_LIMIT: SolveLimit = { expired: () => false };

class Expired extends Error {}

/** Candidates split by feedback key, solved bucket left out. */
function split(space: CodeSpace, guess: number, candidates: Int32Array): Int32Array[] {
  const sizes = new Int32Array(KEYS);
  for (let i = 0; i < candidates.length; i++) sizes[feedbackKey(space, guess, candidates[i])]++;
  const buckets: (Int32Array | null)[] = Array.from(sizes, (size, key) => (size > 0 && key !== SOLVED_KEY ? new Int32Array(size) : null));
  const fill = new Int32Array(KEYS);
  for (let i = 0; i < candidates.length; i++) {
    const key = feedbackKey(space, guess, candidates[i]);
    const bucket = buckets[key];
    if (bucket) bucket[fill[key]++] = candidates[i];
  }
  return buckets.filter((bucket): bucket is Int32Array => bucket !== null);
}

/** Lower bound of the expected guesses for `n` candidates: a guess can win at once only with chance 1/n. */
const floorCost = (n: number): number => (n <= 1 ? 1 : 2 - 1 / n);

interface Solution {
  readonly cost: number;
  readonly guess: number;
}

/**
 * Exact expected guesses (this one included) and the best guess for a small candidate set, over every code
 * of the space as a possible guess. Memoized by candidate set; throws when `limit` expires.
 */
function solveExact(space: CodeSpace, candidates: Int32Array, memo: Map<string, Solution>, limit: SolveLimit): Solution {
  const n = candidates.length;
  if (n === 1) return { cost: 1, guess: candidates[0] };
  const key = candidates.join();
  const known = memo.get(key);
  if (known) return known;
  if (limit.expired()) throw new Expired();
  const member = new Set<number>(candidates);
  // Bound every guess from below by its bucket sizes, then examine them from the most promising.
  const options: { guess: number; bound: number }[] = [];
  const sizes = new Int32Array(KEYS);
  for (let guess = 0; guess < space.codes.length; guess++) {
    sizes.fill(0);
    for (let i = 0; i < n; i++) sizes[feedbackKey(space, guess, candidates[i])]++;
    let bound = 1;
    for (let k = 0; k < SOLVED_KEY; k++) if (sizes[k] > 0) bound += (sizes[k] / n) * floorCost(sizes[k]);
    options.push({ guess, bound: bound - (member.has(guess) ? 1e-9 : 0) });
  }
  options.sort((a, b) => a.bound - b.bound || a.guess - b.guess);
  let best: Solution = { cost: Infinity, guess: candidates[0] };
  for (const option of options) {
    if (option.bound >= best.cost - 1e-12) break;
    let cost = 1;
    const buckets = split(space, option.guess, candidates);
    // A guess that tells the candidates apart not at all can only repeat the same question.
    if (buckets.some((bucket) => bucket.length === n)) continue;
    for (const bucket of buckets) {
      cost += (bucket.length / n) * solveExact(space, bucket, memo, limit).cost;
      if (cost >= best.cost) break;
    }
    if (cost < best.cost - 1e-12) best = { cost, guess: option.guess };
  }
  memo.set(key, best);
  return best;
}

/** Exact best guess for a candidate set of any size the caller can afford; `memo` may be shared between calls. */
export function solveExactGuess(space: CodeSpace, candidates: Int32Array, limit: SolveLimit, memo = new Map<string, Solution>()): number {
  return candidates.length <= 2 ? candidates[0] : solveExact(space, candidates, memo, limit).guess;
}

/** Largest candidate set solved exactly: the search is over every guess at every level. */
export const EXACT_LIMIT = 8;

/**
 * Estimated guesses for a candidate set: exact when small, otherwise the best of a few top guesses, each valued
 * by looking one level deeper, down to the fitted finish curve.
 */
function valueOf(space: CodeSpace, candidates: Int32Array, depth: number, memo: Map<string, Solution>, limit: SolveLimit): number {
  const n = candidates.length;
  if (n <= EXACT_LIMIT) return solveExact(space, candidates, memo, limit).cost;
  if (depth <= 0) return finishEstimate(space.variant, n);
  return lookahead(space, candidates, depth, memo, limit).cost;
}

function lookahead(space: CodeSpace, candidates: Int32Array, depth: number, memo: Map<string, Solution>, limit: SolveLimit): Solution {
  if (limit.expired()) throw new Expired();
  const n = candidates.length;
  const width = depth >= 2 ? 4 : 2;
  const top = bestGuesses(space, candidates, width);
  let best: Solution = { cost: Infinity, guess: top[0].guess };
  for (const { guess } of top) {
    let cost = 1;
    for (const bucket of split(space, guess, candidates)) cost += (bucket.length / n) * valueOf(space, bucket, depth - 1, memo, limit);
    if (cost < best.cost - 1e-12) best = { cost, guess };
  }
  return best;
}

/** How many levels of lookahead to use for a candidate set of this size, within a typical decision budget. */
export function lookaheadDepth(n: number): number {
  return n > 120 ? 0 : 2;
}

/**
 * The guess (a code index) to play against the remaining candidates. Falls back to the one-step estimate when
 * `limit` expires mid-search.
 */
export function chooseGuessIndex(space: CodeSpace, candidates: Int32Array, limit: SolveLimit, depth?: number): number {
  const n = candidates.length;
  if (n <= 2) return candidates[0];
  try {
    const memo = new Map<string, Solution>();
    if (n <= EXACT_LIMIT) return solveExact(space, candidates, memo, limit).guess;
    const levels = depth ?? lookaheadDepth(n);
    return levels <= 0 ? bestGuesses(space, candidates, 1)[0].guess : lookahead(space, candidates, levels, memo, limit).guess;
  } catch (error) {
    if (!(error instanceof Expired)) throw error;
    return bestGuesses(space, candidates, 1)[0].guess;
  }
}
