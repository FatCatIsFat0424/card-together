import type { Card } from '@shared/types';
import { cardId, evaluateIds } from './holdem-evaluator';

/** Decides whether an opponent could plausibly hold the two card ids; `null` means any hand. */
export type HandFilter = (first: number, second: number) => boolean;

/** An unfolded opponent: the hands it may hold, and how likely it is to still be in the hand at showdown. */
export interface Opponent {
  readonly filter: HandFilter | null;
  /** Below 1 for seats that have yet to act and may fold to the pending bet. */
  readonly stays: number;
}

export interface EquityRequest {
  readonly hole: readonly Card[];
  readonly board: readonly Card[];
  readonly opponents: readonly Opponent[];
  readonly random: () => number;
  /** Equities a decision hinges on; sampling continues past `minRuns` only while the estimate is near one. */
  readonly thresholds?: readonly number[];
  readonly minRuns?: number;
  readonly maxRuns?: number;
}

const BLOCK_RUNS = 48;
const MIN_RUNS = 48;
const MAX_RUNS = 288;
const CONFIDENCE_Z = 2.3;
const REJECTION_TRIES = 40;

function swap(pool: Int8Array, a: number, b: number): void {
  const held = pool[a];
  pool[a] = pool[b];
  pool[b] = held;
}

/** Moves a random accepted pair to `pool[next]` and `pool[next + 1]`, settling for the last draw if none is accepted. */
function drawHand(pool: Int8Array, next: number, filter: HandFilter | null, random: () => number): void {
  const size = pool.length - next;
  const tries = filter ? REJECTION_TRIES : 1;
  for (let attempt = 0; attempt < tries; attempt++) {
    const i = next + Math.floor(random() * size);
    let j = next + Math.floor(random() * (size - 1));
    if (j >= i) j += 1;
    if (attempt < tries - 1 && filter && !filter(pool[i], pool[j])) continue;
    swap(pool, next, i);
    swap(pool, next + 1, j === next ? i : j);
    return;
  }
}

function unseenPool(known: readonly number[]): Int8Array {
  const seen = new Set(known);
  const ids: number[] = [];
  for (let id = 0; id < 52; id++) if (!seen.has(id)) ids.push(id);
  return Int8Array.from(ids);
}

/** Exact river equity against one opponent: every unseen pair the filter accepts, equally weighted. */
function exactRiverEquity(hole: readonly number[], board: readonly number[], filter: HandFilter | null): number {
  const pool = unseenPool([...hole, ...board]);
  const cards = [...hole, ...board];
  const mine = evaluateIds(cards, 7);
  const versus = [0, 0, ...board];
  let total = 0;
  let won = 0;
  let accepted = false;
  for (let pass = 0; pass < 2 && !accepted; pass++) {
    // The second pass runs unfiltered, which only matters when the filter rejects every pair.
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (pass === 0 && filter && !filter(pool[i], pool[j])) continue;
        versus[0] = pool[i];
        versus[1] = pool[j];
        const theirs = evaluateIds(versus, 7);
        total += 1;
        won += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      }
    }
    accepted = total > 0;
  }
  return won / total;
}

function sampleEquity(request: EquityRequest, hole: readonly number[], board: readonly number[]): number {
  const { opponents, random } = request;
  const pool = unseenPool([...hole, ...board]);
  const missing = 5 - board.length;
  const mineCards = [...hole, ...board, 0, 0, 0, 0, 0].slice(0, 7);
  const theirCards = new Array<number>(7).fill(0);
  const thresholds = request.thresholds ?? [];
  const minRuns = request.minRuns ?? MIN_RUNS;
  const maxRuns = request.maxRuns ?? MAX_RUNS;
  let runs = 0;
  let won = 0;
  while (runs < maxRuns) {
    const stop = Math.min(maxRuns, runs + BLOCK_RUNS);
    for (; runs < stop; runs++) {
      let next = 0;
      let live = 0;
      for (const opponent of opponents) {
        if (opponent.stays < 1 && random() >= opponent.stays) continue;
        drawHand(pool, next, opponent.filter, random);
        next += 2;
        live += 1;
      }
      // Partial Fisher-Yates: the next cards of the pool become a uniform sample for the board.
      for (let i = 0; i < missing; i++) {
        swap(pool, next + i, next + i + Math.floor(random() * (pool.length - next - i)));
        mineCards[2 + board.length + i] = pool[next + i];
      }
      for (let i = 0; i < board.length; i++) theirCards[2 + i] = board[i];
      for (let i = 0; i < missing; i++) theirCards[2 + board.length + i] = pool[next + i];
      const mine = evaluateIds(mineCards, 7);
      let ties = 0;
      let lost = false;
      for (let opponent = 0; opponent < live && !lost; opponent++) {
        theirCards[0] = pool[opponent * 2];
        theirCards[1] = pool[opponent * 2 + 1];
        const theirs = evaluateIds(theirCards, 7);
        if (theirs > mine) lost = true;
        else if (theirs === mine) ties += 1;
      }
      if (!lost) won += 1 / (ties + 1);
    }
    if (runs >= minRuns) {
      const estimate = won / runs;
      const spread = CONFIDENCE_Z * Math.sqrt(Math.max(estimate * (1 - estimate), 0.04) / runs);
      if (thresholds.every((threshold) => Math.abs(estimate - threshold) > spread)) break;
    }
  }
  return won / runs;
}

/**
 * Chance of winning the pot (ties split) against the given opponent ranges. The river against a single opponent
 * is enumerated exactly; every other spot is sampled and stops early once no threshold is within reach.
 */
export function estimateEquity(request: EquityRequest): number {
  const hole = request.hole.map(cardId);
  const board = request.board.map(cardId);
  if (request.opponents.length === 0) return 1;
  if (board.length === 5 && request.opponents.length === 1) return exactRiverEquity(hole, board, request.opponents[0].filter);
  return sampleEquity(request, hole, board);
}

/** Share of simulated showdowns won against `opponents` random hands, ties split. */
export function holdemEquity(
  hole: readonly Card[], board: readonly Card[], opponents: number, random: () => number, simulations = MAX_RUNS,
): number {
  return estimateEquity({
    hole, board, random, opponents: new Array<Opponent>(opponents).fill({ filter: null, stays: 1 }), minRuns: simulations, maxRuns: simulations,
  });
}
