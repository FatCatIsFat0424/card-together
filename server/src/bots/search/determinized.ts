import type { GameSeat } from '@shared/types';
import { seededRandom } from './seeded-random';
import type { SearchContext } from './search-types';

// Determinized search for hidden-information games. Each sample deals the hidden cards (or tiles) at random
// in a way that fits the seat's own view, plays every candidate move on that same world, and scores the
// result by a rollout to the end (or an exact evaluator such as a double-dummy solver). Sharing one world
// and one rollout seed across all candidates (common random numbers) makes their results compare directly,
// so far fewer samples separate them. The heuristic that proposed the candidates keeps the decision until
// enough samples exist, and still breaks ties among candidates within sampling noise of the best.

/** One complete state of the game, consistent with the seat's view. */
export interface SampledWorld<S> {
  readonly state: S;
  /**
   * Relative likelihood of this world given soft evidence (bids, signals, earlier play); 1 when every
   * world is equally likely. Must be finite and non-negative; a world of weight 0 is skipped.
   */
  readonly weight?: number;
}

/**
 * A game plugged into the search. `S` is a mutable full state (every hand known) and `M` a move. The plug-in
 * closes over the seat's filtered view; it never reads hidden server state.
 */
export interface DeterminizedGame<S, M> {
  /** The deciding seat; utilities are read for it. */
  readonly seat: GameSeat;
  /** Deals the unseen cards into one full state (see `dealUnseen`); null when no consistent deal was found. */
  readonly sample: (random: () => number) => SampledWorld<S> | null;
  /** A copy that `play` can change without touching the original; keep it cheap (typed arrays, flat lists). */
  readonly copy: (state: S) => S;
  /** Moves the seat to act may make; read by the default rollout policy only. */
  readonly legalMoves: (state: S) => readonly M[];
  /** Applies a legal move in place and passes the turn as the rules say. */
  readonly play: (state: S, move: M) => void;
  /** Fast rollout policy for whoever acts in `state`; defaults to a uniformly random legal move. */
  readonly rolloutMove?: (state: S, random: () => number) => M;
  readonly isTerminal: (state: S) => boolean;
  /**
   * The seat's result in the game's own unit (points, tricks, chips), larger is better. In partnership games
   * return the side's shared result, so partners agree. Also called on a non-terminal state when a rollout
   * reaches `maxPlies`; return a static evaluation there.
   */
  readonly utility: (state: S, seat: GameSeat) => number;
  /**
   * Exact value for `seat` of a state right after a candidate was played, replacing the rollout (for example
   * a double-dummy solver). Return null when the budget ran out mid-solve: the whole sample is then dropped.
   */
  readonly evaluate?: (state: S, seat: GameSeat, random: () => number) => number | null;
}

/** A move proposed by the game's heuristic; `prior` is the heuristic's score, larger is better. */
export interface Candidate<M> {
  readonly move: M;
  readonly prior: number;
}

export interface DeterminizedOptions {
  /** Worlds examined at most; with a budget that does not expire, the result depends only on the seed. */
  readonly maxSamples?: number;
  /** Fewer worlds than this are too noisy to overrule the heuristic's best candidate. */
  readonly minSamples?: number;
  /** Rollouts per candidate on each world; they share their seeds across candidates. */
  readonly rolloutsPerSample?: number;
  /** Rollout plies before the state is scored as it stands. */
  readonly maxPlies?: number;
  /** Only the best candidates by prior are searched. */
  readonly maxCandidates?: number;
  /** Utility difference, in the game's unit, below which two candidates count as equal. */
  readonly tolerance?: number;
  /** Standard errors of the paired difference to the best below which candidates also count as equal. */
  readonly confidence?: number;
  /** No new world starts once fewer milliseconds than this are left. */
  readonly reserveMs?: number;
}

export interface CandidateStats<M> {
  readonly move: M;
  readonly prior: number;
  /** Weighted mean utility for the deciding seat; NaN when no world completed. */
  readonly mean: number;
}

export interface DeterminizedChoice<M> {
  readonly move: M;
  /** Completed worlds behind the choice. */
  readonly samples: number;
  /**
   * `single`: one candidate, no search. `prior`: too few worlds, the heuristic decided.
   * `searched`: the best mean, ties broken by prior.
   */
  readonly reason: 'single' | 'prior' | 'searched';
  /** The searched candidates in prior order, best first. */
  readonly stats: readonly CandidateStats<M>[];
}

const DEFAULTS: Required<DeterminizedOptions> = {
  maxSamples: 200,
  minSamples: 6,
  rolloutsPerSample: 1,
  maxPlies: 1_000,
  maxCandidates: Infinity,
  tolerance: 0,
  confidence: 1,
  reserveMs: 0,
};

function uniformMove<S, M>(game: DeterminizedGame<S, M>, state: S, random: () => number): M {
  const moves = game.legalMoves(state);
  if (moves.length === 0) throw new Error('A rollout reached a non-terminal state without legal moves.');
  return moves[Math.floor(random() * moves.length)];
}

/** Plays `state` out with the rollout policy and returns the seat's utility. */
function rollout<S, M>(game: DeterminizedGame<S, M>, state: S, random: () => number, maxPlies: number): number {
  for (let ply = 0; ply < maxPlies && !game.isTerminal(state); ply++) {
    game.play(state, game.rolloutMove ? game.rolloutMove(state, random) : uniformMove(game, state, random));
  }
  return game.utility(state, game.seat);
}

/** The value of `candidate` on one world, or null when the evaluator ran out of time. */
function valueOn<S, M>(
  game: DeterminizedGame<S, M>, world: S, candidate: M, seeds: readonly number[], options: Required<DeterminizedOptions>,
  reuse: boolean,
): number | null {
  if (game.evaluate) {
    const state = reuse ? world : game.copy(world);
    game.play(state, candidate);
    return game.evaluate(state, game.seat, seededRandom(seeds[0]));
  }
  let total = 0;
  for (let index = 0; index < seeds.length; index++) {
    const state = reuse && index === seeds.length - 1 ? world : game.copy(world);
    game.play(state, candidate);
    total += rollout(game, state, seededRandom(seeds[index]), options.maxPlies);
  }
  return total / seeds.length;
}

/**
 * Chooses among the heuristic's candidates by sampling worlds that fit the seat's view. Stops at `maxSamples`
 * or when `context.budget` runs out (checked between candidates; an unfinished world is dropped so every
 * candidate is scored on the same worlds). Never mutates `candidates` or anything the plug-in closes over;
 * each candidate plays on its own copy of the sampled state.
 */
export function determinizedSearch<S, M>(
  game: DeterminizedGame<S, M>, candidates: readonly Candidate<M>[], context: SearchContext,
  options: DeterminizedOptions = {},
): DeterminizedChoice<M> {
  if (candidates.length === 0) throw new Error('Determinized search needs at least one candidate.');
  const settings = { ...DEFAULTS, ...options };
  const ranked = candidates.map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => b.candidate.prior - a.candidate.prior || a.index - b.index)
    .slice(0, Math.max(1, settings.maxCandidates))
    .map(({ candidate }) => candidate);
  const values: number[][] = ranked.map(() => []);
  const weights: number[] = [];
  const { budget, random } = context;
  const outOfTime = (): boolean => budget.expired() || budget.timeLeftMs() < settings.reserveMs;

  if (ranked.length > 1) {
    // Failed or weightless deals also count toward the cap, so an impossible view cannot loop forever.
    let skipped = 0;
    sampling: while (weights.length < settings.maxSamples && skipped < settings.maxSamples && !outOfTime()) {
      const world = game.sample(random);
      const seeds = Array.from({ length: settings.rolloutsPerSample }, () => Math.floor(random() * 4294967296));
      const weight = world?.weight ?? 1;
      if (!(weight >= 0) || !Number.isFinite(weight)) throw new RangeError('A sampled world needs a finite, non-negative weight.');
      if (!world || weight === 0) {
        skipped++;
        continue;
      }
      const results: number[] = [];
      for (let index = 0; index < ranked.length; index++) {
        if (index > 0 && budget.expired()) break sampling;
        const value = valueOn(game, world.state, ranked[index].move, seeds, settings, index === ranked.length - 1);
        if (value === null) break sampling;
        results.push(value);
      }
      results.forEach((value, index) => values[index].push(value));
      weights.push(weight);
    }
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const means = values.map((list) => (list.length === 0 ? NaN
    : list.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight));
  const stats = ranked.map((candidate, index) => ({ move: candidate.move, prior: candidate.prior, mean: means[index] }));
  const samples = weights.length;
  if (ranked.length === 1) return { move: ranked[0].move, samples, reason: 'single', stats };
  if (samples < settings.minSamples) return { move: ranked[0].move, samples, reason: 'prior', stats };

  let best = 0;
  for (let index = 1; index < ranked.length; index++) if (means[index] > means[best]) best = index;
  // `ranked` is in prior order, so the first candidate within noise of the best has the best prior.
  const chosen = ranked.findIndex((_, index) => index === best
    || pairedGap(values[best], values[index], weights, totalWeight, settings.confidence) <= settings.tolerance);
  return { move: ranked[chosen].move, samples, reason: 'searched', stats };
}

/**
 * How far `other` trails `best` beyond `confidence` standard errors of the weighted paired difference.
 * Pairing on the same worlds removes the variance the worlds share.
 */
function pairedGap(
  best: readonly number[], other: readonly number[], weights: readonly number[], totalWeight: number, confidence: number,
): number {
  let mean = 0;
  for (let index = 0; index < weights.length; index++) mean += (best[index] - other[index]) * weights[index];
  mean /= totalWeight;
  if (confidence <= 0 || weights.length < 2) return mean;
  let spread = 0;
  let squaredWeights = 0;
  for (let index = 0; index < weights.length; index++) {
    const share = weights[index] / totalWeight;
    spread += share * (best[index] - other[index] - mean) ** 2;
    squaredWeights += share * share;
  }
  // Standard error of a weighted mean, using Kish's effective sample size.
  const effective = 1 / squaredWeights;
  const standardError = Math.sqrt(spread / Math.max(1, effective - 1));
  return mean - confidence * standardError;
}
