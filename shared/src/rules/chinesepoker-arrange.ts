// ─── Chinese Poker arrangement search (pure; shared by the server bot and the browser's auto arrange) ───
// Rules: docs/games.md#chinese-poker

import type { Card, ChinesePokerArrangement, ChinesePokerCategory, ChinesePokerRow } from '../types';
import { CP_CATEGORY_ORDER, CP_HAND_SIZE, cpEvaluate, cpRowValue, cpSortHand } from './chinesepoker';
import type { CpEvaluation } from './chinesepoker';

export interface CpRankedArrangement {
  readonly arrangement: ChinesePokerArrangement;
  /** Estimated points against one typical opponent; higher is better */
  readonly score: number;
}

type Anchor = readonly [category: ChinesePokerCategory, topRank: number, winProbability: number];

/**
 * Piecewise-linear chance of beating a random opponent's same row, measured from 6,000 simulated
 * hands arranged by this search; between anchors, strength grows with the top and second ranks.
 */
const STRENGTH_ANCHORS: Record<ChinesePokerRow, readonly Anchor[]> = {
  front: [
    ['highCard', 2, 0], ['highCard', 11, 0.012], ['highCard', 13, 0.047], ['highCard', 14, 0.119],
    ['pair', 2, 0.35], ['pair', 7, 0.528], ['pair', 9, 0.639], ['pair', 13, 0.93], ['pair', 14, 0.967],
    ['threeOfAKind', 2, 0.99], ['threeOfAKind', 14, 1],
  ],
  middle: [
    ['highCard', 2, 0], ['highCard', 13, 0.002], ['pair', 6, 0.046], ['pair', 9, 0.107], ['pair', 11, 0.183],
    ['pair', 13, 0.299], ['twoPair', 2, 0.465], ['twoPair', 11, 0.546], ['threeOfAKind', 3, 0.679],
    ['straight', 5, 0.783], ['straight', 14, 0.923], ['flush', 10, 0.932], ['fullHouse', 2, 0.987],
    ['fullHouse', 7, 0.996], ['straightFlush', 14, 1],
  ],
  back: [
    ['highCard', 2, 0], ['pair', 11, 0.011], ['twoPair', 4, 0.044], ['threeOfAKind', 2, 0.163],
    ['straight', 4, 0.181], ['flush', 2, 0.396], ['flush', 11, 0.414], ['flush', 13, 0.477], ['flush', 14, 0.549],
    ['fullHouse', 2, 0.669], ['fullHouse', 9, 0.799], ['fourOfAKind', 2, 0.951], ['straightFlush', 14, 1],
  ],
};

const coordinate = (category: ChinesePokerCategory, rank: number): number =>
  CP_CATEGORY_ORDER.indexOf(category) * 13 + rank - 2;

const ANCHOR_POINTS: Record<ChinesePokerRow, readonly (readonly [number, number])[]> = {
  front: STRENGTH_ANCHORS.front.map(([category, rank, p]) => [coordinate(category, rank), p]),
  middle: STRENGTH_ANCHORS.middle.map(([category, rank, p]) => [coordinate(category, rank), p]),
  back: STRENGTH_ANCHORS.back.map(([category, rank, p]) => [coordinate(category, rank), p]),
};

function winProbability(row: ChinesePokerRow, evaluation: CpEvaluation): number {
  const x = coordinate(evaluation.category, evaluation.ranks[0]) + ((evaluation.ranks[1] ?? 2) - 2) / 13;
  const points = ANCHOR_POINTS[row];
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, p1] = points[i];
    if (x <= x1) {
      const [x0, p0] = points[i - 1];
      return p0 + (p1 - p0) * (x - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Expected points against one opponent who wins a lost row for about one point. Rows are treated as
 * independent, which also prices the shoot doubling as winning or losing all three rows.
 */
function expectedPoints(pFront: number, vFront: number, pMiddle: number, vMiddle: number,
  pBack: number, vBack: number): number {
  const rows = pFront * vFront + pMiddle * vMiddle + pBack * vBack - (3 - pFront - pMiddle - pBack);
  const shoot = pFront * pMiddle * pBack * (vFront + vMiddle + vBack);
  const shot = (1 - pFront) * (1 - pMiddle) * (1 - pBack) * 3;
  return rows + shoot - shot;
}

/** Estimated score of an arrangement as used by the search; meaningful only for non-foul arrangements. */
export function cpArrangementScore(arrangement: ChinesePokerArrangement): number {
  const front = cpEvaluate(arrangement.front);
  const middle = cpEvaluate(arrangement.middle);
  const back = cpEvaluate(arrangement.back);
  return expectedPoints(
    winProbability('front', front), cpRowValue('front', front),
    winProbability('middle', middle), cpRowValue('middle', middle),
    winProbability('back', back), cpRowValue('back', back),
  );
}

/** Category then ranks packed into one integer; a front's missing ranks pack as 0, matching cpCompare's prefix rule. */
function packKey(evaluation: CpEvaluation): number {
  let key = CP_CATEGORY_ORDER.indexOf(evaluation.category);
  for (let i = 0; i < 5; i++) key = key * 16 + (evaluation.ranks[i] ?? 0);
  return key;
}

const FULL_MASK = (1 << CP_HAND_SIZE) - 1;

const BIT_COUNTS = Uint8Array.from({ length: FULL_MASK + 1 }, (_, mask) => {
  let count = 0;
  for (let rest = mask; rest; rest &= rest - 1) count++;
  return count;
});

/** Every 3- and 5-card subset of the hand, evaluated once and indexed by bitmask. */
interface SubsetTables {
  readonly fives: number[];
  readonly key: Int32Array;
  /** Front win chance and value for 3-card masks; middle for 5-card masks */
  readonly pLow: Float64Array;
  readonly vLow: Float64Array;
  /** Back win chance and value for 5-card masks */
  readonly pBack: Float64Array;
  readonly vBack: Float64Array;
}

function subsetTables(hand: readonly Card[]): SubsetTables {
  const size = FULL_MASK + 1;
  const tables = {
    fives: [] as number[], key: new Int32Array(size), pLow: new Float64Array(size), vLow: new Float64Array(size),
    pBack: new Float64Array(size), vBack: new Float64Array(size),
  };
  for (let mask = 0; mask < size; mask++) {
    const count = BIT_COUNTS[mask];
    if (count !== 3 && count !== 5) continue;
    const evaluation = cpEvaluate(cardsOf(hand, mask));
    tables.key[mask] = packKey(evaluation);
    const low: ChinesePokerRow = count === 3 ? 'front' : 'middle';
    tables.pLow[mask] = winProbability(low, evaluation);
    tables.vLow[mask] = cpRowValue(low, evaluation);
    if (count === 5) {
      tables.fives.push(mask);
      tables.pBack[mask] = winProbability('back', evaluation);
      tables.vBack[mask] = cpRowValue('back', evaluation);
    }
  }
  return tables;
}

function cardsOf(hand: readonly Card[], mask: number): Card[] {
  return hand.filter((_, index) => mask & (1 << index));
}

function arrangementOf(hand: readonly Card[], front: number, middle: number, back: number): ChinesePokerArrangement {
  const row = (mask: number): Card[] => cpSortHand(cardsOf(hand, mask)).map(({ suit, rank }) => ({ suit, rank }));
  return { front: row(front), middle: row(middle), back: row(back) };
}

function requireHand(hand: readonly Card[]): void {
  if (hand.length !== CP_HAND_SIZE) throw new RangeError('A Chinese Poker hand has 13 cards');
}

/** Strongest 5-card mask by packed key among masks disjoint from `excluded` */
function strongestFive(tables: SubsetTables, excluded: number): number {
  let best = -1;
  for (const mask of tables.fives) {
    if ((mask & excluded) === 0 && (best < 0 || tables.key[mask] > tables.key[best])) best = mask;
  }
  return best;
}

/**
 * Best five of 13 to the back, best five of the remaining eight to the middle, the last three to the front.
 * This never fouls: the middle was a candidate for the back, so back ≥ middle. The eight middle candidates
 * include the front's three cards, and any five that contain them is at least as strong over the front's
 * rank prefix (trips stay trips or better, a pair keeps its pair and a kicker no lower, high cards only rise),
 * so the best five is too, giving middle ≥ front.
 */
export function cpGreedyArrangement(hand: readonly Card[]): ChinesePokerArrangement {
  requireHand(hand);
  const tables = subsetTables(hand);
  const back = strongestFive(tables, 0);
  const middle = strongestFive(tables, back);
  return arrangementOf(hand, FULL_MASK ^ back ^ middle, middle, back);
}

interface Candidate {
  readonly score: number;
  readonly front: number;
  readonly middle: number;
  readonly back: number;
}

/**
 * The `limit` highest-scoring non-foul arrangements, best first. Searches all
 * C(13,5) × C(8,5) = 72,072 splits against precomputed subset evaluations.
 */
export function cpRankArrangements(hand: readonly Card[], limit: number): CpRankedArrangement[] {
  requireHand(hand);
  const count = Math.max(1, Math.floor(limit));
  const { fives, key, pLow, vLow, pBack, vBack } = subsetTables(hand);
  const top: Candidate[] = [];
  for (const back of fives) {
    const rest = FULL_MASK ^ back;
    for (let middle = rest; middle; middle = (middle - 1) & rest) {
      if (BIT_COUNTS[middle] !== 5 || key[middle] > key[back]) continue;
      const front = rest ^ middle;
      if (key[front] > key[middle]) continue;
      const score = expectedPoints(pLow[front], vLow[front], pLow[middle], vLow[middle], pBack[back], vBack[back]);
      if (top.length === count && score <= top[count - 1].score) continue;
      let index = top.length < count ? top.length : count - 1;
      while (index > 0 && top[index - 1].score < score) index--;
      top.splice(index, 0, { score, front, middle, back });
      if (top.length > count) top.pop();
    }
  }
  return top.map(({ score, front, middle, back }) => ({ arrangement: arrangementOf(hand, front, middle, back), score }));
}

/** Highest-scoring non-foul arrangement */
export function cpBestArrangement(hand: readonly Card[]): ChinesePokerArrangement {
  return cpRankArrangements(hand, 1)[0].arrangement;
}
