import type { Card, ChinesePokerArrangement, ChinesePokerRow, ChinesePokerVisibleState } from '@shared/types';
import { CP_CATEGORY_ORDER, CP_HAND_SIZE } from '@shared/rules/chinesepoker';
import { cpExpectedPoints, cpRankArrangements, cpRowWinProbability } from '@shared/rules/chinesepoker-arrange';
import type { BotAction } from './bot-decisions';
import type { SearchContext } from './search/search-types';

// Sampled search for Chinese Poker (十三支). The unseen 39 cards are dealt to the three opponents at random,
// each opponent arranges by the static ranking, and every strong candidate arrangement is scored against the
// same sampled opponents under the exact house scoring (rows, shoot, home run). Using the same deals for all
// candidates makes their scores comparable; the best mean score wins.

/** Static top candidates scored against the samples. */
const CANDIDATES = 60;
/** Samples after which the search may stop even with budget left. */
const MAX_SAMPLES = 3000;
/** Samples before the sampled means are trusted over the static order. */
const MIN_SAMPLES = 24;
/** Back rows an opponent's arrangement tries, strongest first: a lower one never made the static best. */
const BACK_LIMIT = 200;

const SUIT_INDEX: Readonly<Record<Card['suit'], number>> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };

const FIVE_MASKS_PER_HAND = 1287;
const FULL_MASK = (1 << CP_HAND_SIZE) - 1;
const BITS = Uint8Array.from({ length: FULL_MASK + 1 }, (_, mask) => {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
});

/** Category index and ranks packed into one integer, the same order the shared rules compare rows by. */
function pack(category: number, a = 0, b = 0, c = 0, d = 0, e = 0): number {
  return ((((category * 16 + a) * 16 + b) * 16 + c) * 16 + d) * 16 + e;
}

const sorted = new Int32Array(5);

/** Packed strength of a 3- or 5-card row from its ranks and suits; larger beats smaller. */
function rowKey(count: 3 | 5, ranks: ArrayLike<number>, suits: ArrayLike<number>): number {
  for (let i = 0; i < count; i++) {
    const rank = ranks[i];
    let j = i;
    while (j > 0 && sorted[j - 1] < rank) {
      sorted[j] = sorted[j - 1];
      j--;
    }
    sorted[j] = rank;
  }
  const a = sorted[0], b = sorted[1], c = sorted[2], d = sorted[3], e = sorted[4];
  if (count === 3) {
    if (a === c) return pack(3, a);
    if (a === b) return pack(1, a, c);
    return b === c ? pack(1, b, a) : pack(0, a, b, c);
  }
  const flush = suits[0] === suits[1] && suits[1] === suits[2] && suits[2] === suits[3] && suits[3] === suits[4];
  const distinct = a !== b && b !== c && c !== d && d !== e;
  if (distinct) {
    const top = a - e === 4 ? a : a === 14 && b === 5 && e === 2 ? 5 : 0;
    if (top > 0) return pack(flush ? 8 : 4, top);
  }
  // Same-rank runs of the sorted ranks: four of a kind, full house, trips, two pair and pair
  if (a === d) return pack(7, a, e);
  if (b === e) return pack(7, b, a);
  if (a === c && d === e) return pack(6, a, d);
  if (a === b && c === e) return pack(6, c, a);
  if (flush) return pack(5, a, b, c, d, e);
  if (a === c) return pack(3, a, d, e);
  if (b === d) return pack(3, b, a, e);
  if (c === e) return pack(3, c, a, b);
  if (a === b) return c === d ? pack(2, a, c, e) : d === e ? pack(2, a, d, c) : pack(1, a, c, d, e);
  if (b === c) return d === e ? pack(2, b, d, a) : pack(1, b, a, d, e);
  if (c === d) return pack(1, c, a, b, e);
  return d === e ? pack(1, d, a, b, c) : pack(0, a, b, c, d, e);
}

const categoryOf = (key: number): number => key >> 20;

/** Points a row is worth to its winner, by category index. */
function rowValue(row: 0 | 1 | 2, key: number): number {
  const category = categoryOf(key);
  if (row === 0) return category === 3 ? 3 : 1;
  if (row === 1) return category === 8 ? 10 : category === 7 ? 8 : category === 6 ? 2 : 1;
  return category === 8 ? 5 : category === 7 ? 4 : 1;
}

const ROW_NAMES: readonly ChinesePokerRow[] = ['front', 'middle', 'back'];

/** Static chance of beating a random opponent's row, tabulated by row, category, top rank and second rank (0 = none). */
const WIN_CHANCE = (() => {
  const table = new Float64Array(3 * 9 * 16 * 16);
  for (let row = 0; row < 3; row++) {
    for (let category = 0; category < 9; category++) {
      for (let first = 2; first <= 14; first++) {
        for (let second = 0; second <= 14; second++) {
          const ranks = second === 0 ? [first] : [first, second];
          table[((row * 9 + category) * 16 + first) * 16 + second] = cpRowWinProbability(
            ROW_NAMES[row], { category: CP_CATEGORY_ORDER[category], ranks },
          );
        }
      }
    }
  }
  return table;
})();

function winChance(row: 0 | 1 | 2, key: number): number {
  return WIN_CHANCE[((row * 9 + (key >> 20)) * 16 + ((key >> 16) & 15)) * 16 + ((key >> 12) & 15)];
}

/** Rows of a hand's 3- and 5-card subsets, indexed by bit mask. */
interface HandTables {
  readonly key: Int32Array;
  readonly pFront: Float64Array;
  readonly vFront: Float64Array;
  readonly pMiddle: Float64Array;
  readonly vMiddle: Float64Array;
  readonly pBack: Float64Array;
  readonly vBack: Float64Array;
  readonly fives: Int32Array;
}

const MASKS = FULL_MASK + 1;
const tables: HandTables = {
  key: new Int32Array(MASKS), pFront: new Float64Array(MASKS), vFront: new Float64Array(MASKS),
  pMiddle: new Float64Array(MASKS), vMiddle: new Float64Array(MASKS), pBack: new Float64Array(MASKS),
  vBack: new Float64Array(MASKS), fives: new Int32Array(FIVE_MASKS_PER_HAND),
};
const freeBits = new Int32Array(8);
const subsetRanks = new Int32Array(5);
const subsetSuits = new Int32Array(5);

/** Every 3- and 5-card subset of 13 positions: its mask and the positions it holds. */
const SUBSETS = (() => {
  const masks: number[] = [];
  const positions: number[] = [];
  for (let mask = 0; mask < MASKS; mask++) {
    const count = BITS[mask];
    if (count !== 3 && count !== 5) continue;
    masks.push(mask);
    for (let bit = 0; bit < CP_HAND_SIZE; bit++) if (mask & (1 << bit)) positions.push(bit);
  }
  return { masks: Int32Array.from(masks), positions: Int32Array.from(positions) };
})();

/** Fills the shared scratch tables for a hand. */
function fillTables(ranks: ArrayLike<number>, suits: ArrayLike<number>): void {
  let fives = 0;
  let cursor = 0;
  const { masks, positions } = SUBSETS;
  for (let item = 0; item < masks.length; item++) {
    const mask = masks[item];
    const count = BITS[mask];
    for (let n = 0; n < count; n++) {
      const index = positions[cursor++];
      subsetRanks[n] = ranks[index];
      subsetSuits[n] = suits[index];
    }
    const key = rowKey(count as 3 | 5, subsetRanks, subsetSuits);
    tables.key[mask] = key;
    if (count === 3) {
      tables.pFront[mask] = winChance(0, key);
      tables.vFront[mask] = rowValue(0, key);
    } else {
      tables.fives[fives++] = mask;
      tables.pMiddle[mask] = winChance(1, key);
      tables.vMiddle[mask] = rowValue(1, key);
      tables.pBack[mask] = winChance(2, key);
      tables.vBack[mask] = rowValue(2, key);
    }
  }
}

/** Every way to choose 5 of 8 positions, as position lists. */
const FIVE_OF_EIGHT: readonly (readonly number[])[] = (() => {
  const result: number[][] = [];
  for (let mask = 0; mask < 256; mask++) {
    if (BITS[mask] !== 5) continue;
    result.push(Array.from({ length: 8 }, (_, bit) => bit).filter((bit) => mask & (1 << bit)));
  }
  return result;
})();

const orderBuf = new Float64Array(FIVE_MASKS_PER_HAND);

/**
 * The static ranking's best arrangement of the hand in the scratch tables, as row keys; scores as
 * `cpRankArrangements(hand, 1)` does, though equal-scoring arrangements may differ. Fills `out` with the front,
 * middle and back keys from `offset` and returns the static score.
 */
function bestKeys(out: Int32Array, offset: number): number {
  const { key, pFront, vFront, pMiddle, vMiddle, pBack, vBack, fives } = tables;
  let bestScore = -Infinity;
  let bestFront = 0;
  let bestMiddle = 0;
  let bestBack = 0;
  const free = freeBits;
  for (let i = 0; i < FIVE_MASKS_PER_HAND; i++) orderBuf[i] = tables.key[fives[i]] * 8192 + fives[i];
  orderBuf.sort();
  for (let index = FIVE_MASKS_PER_HAND - 1; index >= FIVE_MASKS_PER_HAND - BACK_LIMIT; index--) {
    const back = orderBuf[index] % 8192;
    const rest = FULL_MASK ^ back;
    let n = 0;
    for (let bits = rest; bits; bits &= bits - 1) free[n++] = bits & -bits;
    for (const positions of FIVE_OF_EIGHT) {
      const middle = free[positions[0]] | free[positions[1]] | free[positions[2]] | free[positions[3]] | free[positions[4]];
      if (key[middle] > key[back]) continue;
      const front = rest ^ middle;
      if (key[front] > key[middle]) continue;
      const score = cpExpectedPoints(pFront[front], vFront[front], pMiddle[middle], vMiddle[middle], pBack[back], vBack[back]);
      if (score > bestScore) {
        bestScore = score;
        bestFront = front;
        bestMiddle = middle;
        bestBack = back;
      }
    }
  }
  out[offset] = key[bestFront];
  out[offset + 1] = key[bestMiddle];
  out[offset + 2] = key[bestBack];
  return bestScore;
}

const cardRanks = (cards: readonly Card[]): number[] => cards.map((card) => card.rank);
const cardSuits = (cards: readonly Card[]): number[] => cards.map((card) => SUIT_INDEX[card.suit]);

/** The static score of the best arrangement of a hand, by the fast path the opponents are arranged with. */
export function staticBestScore(hand: readonly Card[]): number {
  fillTables(cardRanks(hand), cardSuits(hand));
  return bestKeys(new Int32Array(3), 0);
}

/** A candidate arrangement with the static score that ranked it. */
export interface Candidate {
  readonly arrangement: ChinesePokerArrangement;
  readonly prior: number;
  readonly keys: readonly [number, number, number];
}

/** The `count` best arrangements by the static ranking, with their row keys. */
export function rankedCandidates(hand: readonly Card[], count: number): Candidate[] {
  return cpRankArrangements(hand, count).map(({ arrangement, score }) => ({
    arrangement, prior: score,
    keys: [
      rowKey(3, cardRanks(arrangement.front), cardSuits(arrangement.front)),
      rowKey(5, cardRanks(arrangement.middle), cardSuits(arrangement.middle)),
      rowKey(5, cardRanks(arrangement.back), cardSuits(arrangement.back)),
    ],
  }));
}

/** Signed points of `a` against `b` over the three rows, with the shoot doubling. */
function pairing(keys: Int32Array, a: number, b: number, out: Int32Array, slot: number): void {
  let total = 0;
  let wins = 0;
  let losses = 0;
  for (let row = 0; row < 3; row++) {
    const x = keys[a * 3 + row];
    const y = keys[b * 3 + row];
    if (x > y) {
      total += rowValue(row as 0 | 1 | 2, x);
      wins++;
    } else if (x < y) {
      total -= rowValue(row as 0 | 1 | 2, y);
      losses++;
    }
  }
  const shooter = wins === 3 ? 1 : losses === 3 ? -1 : 0;
  out[slot] = shooter === 0 ? total : total * 2;
  out[slot + 6] = shooter;
}

const PAIRS: readonly (readonly [number, number])[] = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
const pairScratch = new Int32Array(12);

/** Final totals of the four seats; seat 0 holds the candidate. Mirrors `cpMatchResult` for non-foul arrangements. */
export function matchTotals(keys: Int32Array, totals: Float64Array): void {
  for (let slot = 0; slot < 6; slot++) pairing(keys, PAIRS[slot][0], PAIRS[slot][1], pairScratch, slot);
  let homeRun = -1;
  for (let seat = 0; seat < 4; seat++) {
    let shot = 0;
    for (let slot = 0; slot < 6; slot++) {
      const [a, b] = PAIRS[slot];
      if ((a === seat && pairScratch[slot + 6] === 1) || (b === seat && pairScratch[slot + 6] === -1)) shot++;
    }
    if (shot === 3) homeRun = seat;
  }
  totals.fill(0);
  for (let slot = 0; slot < 6; slot++) {
    const [a, b] = PAIRS[slot];
    const points = homeRun >= 0 && (a === homeRun || b === homeRun) ? pairScratch[slot] * 2 : pairScratch[slot];
    totals[a] += points;
    totals[b] -= points;
  }
}

/** Mean outcome of each candidate over the sampled opponents. */
export interface ArrangementEstimate {
  readonly samples: number;
  /** Mean match score per candidate */
  readonly score: readonly number[];
}

/** When to stop sampling: after `maxSamples`, or once `expired` says so (at least one sample is always drawn). */
export interface SamplingLimit {
  readonly maxSamples: number;
  readonly expired: () => boolean;
}

function shuffle(cards: number[], random: () => number): void {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
}

/** Scores the candidates against opponents dealt from the cards `hand` does not hold. */
export function estimateArrangements(
  hand: readonly Card[], candidates: readonly Candidate[], random: () => number, limit: SamplingLimit,
): ArrangementEstimate {
  const held = new Set(hand.map((card) => SUIT_INDEX[card.suit] * 13 + card.rank - 2));
  const unseen: number[] = [];
  for (let id = 0; id < 52; id++) if (!held.has(id)) unseen.push(id);
  const scoreSum = new Float64Array(candidates.length);
  const keys = new Int32Array(12);
  const totals = new Float64Array(4);
  const ranks = new Int32Array(CP_HAND_SIZE);
  const suits = new Int32Array(CP_HAND_SIZE);
  let samples = 0;
  while (samples < limit.maxSamples && !(samples >= 1 && limit.expired())) {
    shuffle(unseen, random);
    for (let opponent = 0; opponent < 3; opponent++) {
      for (let slot = 0; slot < CP_HAND_SIZE; slot++) {
        const id = unseen[opponent * CP_HAND_SIZE + slot];
        ranks[slot] = (id % 13) + 2;
        suits[slot] = Math.floor(id / 13);
      }
      fillTables(ranks, suits);
      bestKeys(keys, (opponent + 1) * 3);
    }
    for (let index = 0; index < candidates.length; index++) {
      keys[0] = candidates[index].keys[0];
      keys[1] = candidates[index].keys[1];
      keys[2] = candidates[index].keys[2];
      matchTotals(keys, totals);
      scoreSum[index] += totals[0];
    }
    samples++;
  }
  return { samples, score: Array.from(scoreSum, (sum) => sum / samples) };
}

/** The candidate with the best sampled score; the static order decides until enough samples exist. */
export function chooseArrangement(candidates: readonly Candidate[], estimate: ArrangementEstimate): Candidate {
  if (estimate.samples < MIN_SAMPLES) return candidates[0];
  let best = 0;
  for (let index = 1; index < candidates.length; index++) if (estimate.score[index] > estimate.score[best]) best = index;
  return candidates[best];
}

/** The arrangement of a 13-card hand with the best expected score against sampled opponents. */
export function arrangeBySampling(
  hand: readonly Card[], random: () => number, expired: () => boolean, maxSamples = MAX_SAMPLES,
): ChinesePokerArrangement {
  const candidates = rankedCandidates(hand, CANDIDATES);
  const estimate = estimateArrangements(hand, candidates, random, { maxSamples, expired });
  return chooseArrangement(candidates, estimate).arrangement;
}

/** Search strategy: arranges once while the table is arranging. */
export function chinesePokerSearch(visible: ChinesePokerVisibleState, context: SearchContext): BotAction | null {
  if (visible.phase !== 'arranging' || visible.submitted[visible.mySeat] || visible.myArrangement) return null;
  return {
    type: 'chinesepoker-arrange', arrangement: arrangeBySampling(visible.myHand, context.random, context.budget.expired),
  };
}
