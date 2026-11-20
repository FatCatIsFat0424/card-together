import type { Card } from '@shared/types';
import { cardId, evaluateIds } from './holdem-evaluator';

/** Relative likelihood, 0 to 1, that an opponent holds the two card ids. */
export type HandWeight = (first: number, second: number) => number;

/** A weighted range over the unseen pairs, compiled once for fast sampling and enumeration. */
export interface Range {
  readonly firsts: Int8Array;
  readonly seconds: Int8Array;
  readonly weights: Float64Array;
  /** Running sum of `weights`, for drawing a pair by binary search. */
  readonly cumulative: Float64Array;
  readonly total: number;
}

/** An unfolded opponent: the hands it may hold, and how likely it is to still be in the hand at showdown. */
export interface Opponent {
  readonly range: Range;
  /** Below 1 for seats that may still fold to the pending bet. */
  readonly stays: number;
}

/** How hard an estimate may work; the search sets a larger budget than the synchronous fallback. */
export interface Effort {
  readonly minRuns: number;
  readonly maxRuns: number;
  /** Enumerate the river card and the opponent's hand exactly on the turn against one opponent. */
  readonly exactTurn: boolean;
  /** True once the decision's time is spent; sampling then stops at the next block. */
  readonly expired: () => boolean;
}

export const FAST_EFFORT: Effort = { minRuns: 64, maxRuns: 360, exactTurn: false, expired: () => false };

export interface EquityRequest {
  readonly hole: readonly Card[];
  readonly board: readonly Card[];
  readonly opponents: readonly Opponent[];
  readonly random: () => number;
  readonly effort?: Effort;
  /** Equities a decision hinges on; sampling continues past `minRuns` only while the estimate is near one. */
  readonly thresholds?: readonly number[];
}

const BLOCK_RUNS = 48;
const CONFIDENCE_Z = 2.3;
const PAIR_TRIES = 24;

export const knownIds = (hole: readonly Card[], board: readonly Card[]): number[] => [...hole, ...board].map(cardId);

/** Every unseen pair weighted by `weight` (all equal when null); falls back to equal weights if none is possible. */
export function compileRange(weight: HandWeight | null, dead: readonly number[]): Range {
  const seen = new Uint8Array(52);
  for (const id of dead) seen[id] = 1;
  const unseen: number[] = [];
  for (let id = 0; id < 52; id++) if (!seen[id]) unseen.push(id);
  const size = (unseen.length * (unseen.length - 1)) / 2;
  const firsts = new Int8Array(size);
  const seconds = new Int8Array(size);
  const weights = new Float64Array(size);
  let index = 0;
  let total = 0;
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      firsts[index] = unseen[i];
      seconds[index] = unseen[j];
      const value = weight ? Math.max(0, weight(unseen[i], unseen[j])) : 1;
      weights[index] = value;
      total += value;
      index += 1;
    }
  }
  if (total <= 0) weights.fill(1);
  const cumulative = new Float64Array(size);
  let running = 0;
  for (let i = 0; i < size; i++) {
    running += weights[i];
    cumulative[i] = running;
  }
  return { firsts, seconds, weights, cumulative, total: running };
}

/** Draws a pair index by weight whose cards are both unused, or -1 after repeated collisions. */
function drawPair(range: Range, used: Uint8Array, random: () => number): number {
  const { cumulative, firsts, seconds } = range;
  for (let attempt = 0; attempt < PAIR_TRIES; attempt++) {
    const target = random() * range.total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] > target) high = middle;
      else low = middle + 1;
    }
    if (!used[firsts[low]] && !used[seconds[low]]) return low;
  }
  return -1;
}

/** Exact equity against one opponent on the river, weighting every pair by its range. */
function exactRiver(mine: number, board: readonly number[], range: Range): number {
  const cards = [0, 0, ...board];
  let total = 0;
  let won = 0;
  for (let i = 0; i < range.weights.length; i++) {
    const weight = range.weights[i];
    if (weight <= 0) continue;
    cards[0] = range.firsts[i];
    cards[1] = range.seconds[i];
    const theirs = evaluateIds(cards, 7);
    total += weight;
    won += weight * (mine > theirs ? 1 : mine === theirs ? 0.5 : 0);
  }
  return total > 0 ? won / total : 0.5;
}

/** Exact equity against one opponent on the turn: every river card and every pair of the range. */
function exactTurn(hole: readonly number[], board: readonly number[], range: Range): number {
  const seen = new Uint8Array(52);
  for (const id of [...hole, ...board]) seen[id] = 1;
  const mineCards = [...hole, ...board, 0];
  const theirCards = [0, 0, ...board, 0];
  let total = 0;
  let won = 0;
  for (let river = 0; river < 52; river++) {
    if (seen[river]) continue;
    mineCards[6] = river;
    theirCards[6] = river;
    const mine = evaluateIds(mineCards, 7);
    for (let i = 0; i < range.weights.length; i++) {
      const weight = range.weights[i];
      if (weight <= 0 || range.firsts[i] === river || range.seconds[i] === river) continue;
      theirCards[0] = range.firsts[i];
      theirCards[1] = range.seconds[i];
      const theirs = evaluateIds(theirCards, 7);
      total += weight;
      won += weight * (mine > theirs ? 1 : mine === theirs ? 0.5 : 0);
    }
  }
  return total > 0 ? won / total : 0.5;
}

interface SampleResult {
  /** Share of counted runs won, ties split. */
  readonly equity: number;
  /** Mean number of opponents present in counted runs. */
  readonly present: number;
}

/**
 * Samples showdowns. With `contested`, runs in which every opponent dropped out are redrawn, which gives the equity
 * once at least one opponent continues.
 */
function sample(request: EquityRequest, contested: boolean): SampleResult {
  const { opponents, random } = request;
  const effort = request.effort ?? FAST_EFFORT;
  const hole = request.hole.map(cardId);
  const board = request.board.map(cardId);
  const used = new Uint8Array(52);
  for (const id of [...hole, ...board]) used[id] = 1;
  const pool: number[] = [];
  for (let id = 0; id < 52; id++) if (!used[id]) pool.push(id);
  const missing = 5 - board.length;
  const mineCards = [...hole, ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const theirCards = new Array<number>(7).fill(0);
  for (let i = 0; i < board.length; i++) theirCards[2 + i] = board[i];
  const drawn: number[] = [];
  const hands: number[] = [];
  const thresholds = request.thresholds ?? [];
  let runs = 0;
  let attempts = 0;
  let won = 0;
  let present = 0;
  const maxAttempts = effort.maxRuns * 8;
  while (runs < effort.maxRuns && attempts < maxAttempts) {
    const stop = Math.min(effort.maxRuns, runs + BLOCK_RUNS);
    while (runs < stop && attempts < maxAttempts) {
      attempts += 1;
      hands.length = 0;
      for (const opponent of opponents) {
        if (opponent.stays < 1 && random() >= opponent.stays) continue;
        const pair = drawPair(opponent.range, used, random);
        if (pair < 0) continue;
        const first = opponent.range.firsts[pair];
        const second = opponent.range.seconds[pair];
        used[first] = 1;
        used[second] = 1;
        drawn.push(first, second);
        hands.push(first, second);
      }
      const live = hands.length / 2;
      if (contested && live === 0) continue;
      for (let i = 0; i < missing; i++) {
        // Probing past used cards keeps the draw bounded even for a degenerate generator.
        let slot = Math.floor(random() * pool.length);
        while (used[pool[slot]]) slot = (slot + 1) % pool.length;
        const card = pool[slot];
        used[card] = 1;
        drawn.push(card);
        mineCards[2 + board.length + i] = card;
        theirCards[2 + board.length + i] = card;
      }
      for (const card of drawn) used[card] = 0;
      drawn.length = 0;
      const mine = evaluateIds(mineCards, 7);
      let ties = 0;
      let lost = false;
      for (let opponent = 0; opponent < live && !lost; opponent++) {
        theirCards[0] = hands[opponent * 2];
        theirCards[1] = hands[opponent * 2 + 1];
        const theirs = evaluateIds(theirCards, 7);
        if (theirs > mine) lost = true;
        else if (theirs === mine) ties += 1;
      }
      if (!lost) won += 1 / (ties + 1);
      present += live;
      runs += 1;
    }
    if (runs >= effort.minRuns) {
      if (effort.expired()) break;
      const estimate = won / runs;
      const spread = CONFIDENCE_Z * Math.sqrt(Math.max(estimate * (1 - estimate), 0.04) / runs);
      if (thresholds.every((threshold) => Math.abs(estimate - threshold) > spread)) break;
    }
  }
  return runs === 0 ? { equity: 1, present: 0 } : { equity: won / runs, present: present / runs };
}

function exactSingle(request: EquityRequest): number | null {
  if (request.opponents.length !== 1) return null;
  const effort = request.effort ?? FAST_EFFORT;
  const hole = request.hole.map(cardId);
  const board = request.board.map(cardId);
  const { range } = request.opponents[0];
  if (board.length === 5) return exactRiver(evaluateIds([...hole, ...board], 7), board, range);
  if (board.length === 4 && effort.exactTurn) return exactTurn(hole, board, range);
  return null;
}

/**
 * Chance of winning the pot (ties split) against the given opponent ranges. One opponent is enumerated exactly on the
 * river, and on the turn when the effort allows; every other spot is sampled and stops early once no threshold is
 * within reach.
 */
export function estimateEquity(request: EquityRequest): number {
  if (request.opponents.length === 0) return 1;
  const exact = exactSingle(request);
  if (exact !== null) {
    const stays = request.opponents[0].stays;
    return 1 - stays + stays * exact;
  }
  return sample(request, false).equity;
}

/**
 * Equity once at least one opponent continues, each opponent continuing with its `stays` chance and holding a hand of
 * its range, and the mean number of opponents who continue in that case.
 */
export function estimateContestedEquity(request: EquityRequest): SampleResult {
  if (request.opponents.length === 0) return { equity: 1, present: 0 };
  const exact = exactSingle(request);
  if (exact !== null) return { equity: exact, present: 1 };
  return sample(request, true);
}

/** Share of simulated showdowns won against `opponents` random hands, ties split. */
export function holdemEquity(
  hole: readonly Card[], board: readonly Card[], opponents: number, random: () => number, simulations = 288,
): number {
  const range = compileRange(null, knownIds(hole, board));
  return estimateEquity({
    hole, board, random, opponents: new Array<Opponent>(opponents).fill({ range, stays: 1 }),
    effort: { minRuns: simulations, maxRuns: simulations, exactTurn: false, expired: () => false },
  });
}
