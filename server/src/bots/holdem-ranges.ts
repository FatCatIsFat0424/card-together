import type { Card } from '@shared/types';
import type { HandWeight } from './holdem-equity';
import { cardId, evaluateIds, rankOfId, suitOfId } from './holdem-evaluator';
import type { PostflopRead, PreflopRead } from './holdem-history';
import { preflopRankFractionOf } from './holdem-preflop-table';
import { callLimitOfIds, pushLimitOfIds } from './holdem-push-fold';

// Generic ranges: what a seat holds given the action it took and the size of its bets, the same for every player.

/** Share of hands opened first in by the number of seats still to act; index 0 is unused. */
export const OPEN_SHARE = [0.14, 0.5, 0.4, 0.3, 0.24, 0.2, 0.17, 0.15];

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const rankFraction = (first: number, second: number): number =>
  preflopRankFractionOf(rankOfId(first), rankOfId(second), suitOfId(first) === suitOfId(second));

/** Hands within the best `fraction` of starting hands weigh 1; the rest weigh `tail`. */
export function topHandsWeight(fraction: number, tail = 0): HandWeight {
  return (first, second) => (rankFraction(first, second) <= fraction ? 1 : tail);
}

/** A first-in all-in range from the push chart; hands outside it weigh `tail`. */
export function pushRangeWeight(behind: number, stackBlinds: number, tail: number): HandWeight {
  return (first, second) => (pushLimitOfIds(behind, first, second) >= stackBlinds ? 1 : tail);
}

/** A range that calls a first-in all-in, from the call chart; hands outside it weigh `tail`. */
export function callRangeWeight(behind: number, place: number, stackBlinds: number, tail: number): HandWeight {
  return (first, second) => (callLimitOfIds(behind, place, first, second) >= stackBlinds ? 1 : tail);
}

/** Every present weight multiplied; null when none restricts the range. */
export function productWeight(weights: readonly (HandWeight | null)[]): HandWeight | null {
  const present = weights.filter((weight): weight is HandWeight => weight !== null);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return (first, second) => present.reduce((product, weight) => product * weight(first, second), 1);
}

/** Generic preflop range for a seat's action this hand. */
export function preflopWeight(read: PreflopRead): HandWeight | null {
  switch (read.kind) {
    case 'none':
      return null;
    case 'limp':
      // Strong hands usually raise, so they are less likely after a limp.
      return (first, second) => (rankFraction(first, second) <= 0.05 ? 0.3 : 1);
    case 'open':
      return topHandsWeight(OPEN_SHARE[Math.min(OPEN_SHARE.length - 1, Math.max(1, read.behind))] * 1.1, 0.03);
    case 'reraise':
      return topHandsWeight(read.raisesBefore >= 2 ? 0.04 : 0.09, 0.02);
    case 'shove':
      if (read.raisesBefore === 0) return pushRangeWeight(read.behind, read.stackBlinds, 0.04);
      // An all-in over a raise: wider when shallow, where it is often a resteal.
      return topHandsWeight(clamp(0.3 - 0.008 * read.stackBlinds, 0.08, 0.25) / read.raisesBefore, 0.03);
    case 'callShove':
      return callRangeWeight(read.behind, read.place, read.stackBlinds, 0.04);
    case 'call':
      // Calling a raise: a middling range that would have reraised its best hands.
      return (first, second) => {
        const fraction = rankFraction(first, second);
        return fraction <= 0.03 ? 0.4 : fraction <= 0.4 ? 1 : 0.08;
      };
  }
}

/** Board strength of every unseen holding as a percentile: 0 for the weakest, near 1 for the strongest. */
export function createBoardPercentile(board: readonly Card[], dead: readonly Card[]): (first: number, second: number) => number {
  const boardIds = board.map(cardId);
  const seen = new Set([...boardIds, ...dead.map(cardId)]);
  const unseen: number[] = [];
  for (let id = 0; id < 52; id++) if (!seen.has(id)) unseen.push(id);
  const cards = [0, 0, ...boardIds];
  const scores: number[] = [];
  for (let i = 0; i < unseen.length; i++) {
    for (let j = i + 1; j < unseen.length; j++) {
      cards[0] = unseen[i];
      cards[1] = unseen[j];
      scores.push(evaluateIds(cards, cards.length));
    }
  }
  scores.sort((a, b) => a - b);
  const below = (score: number): number => {
    let low = 0;
    let high = scores.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (scores[middle] < score) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const cache = new Map<number, number>();
  return (first, second) => {
    const key = first < second ? first * 52 + second : second * 52 + first;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    cards[0] = first;
    cards[1] = second;
    const score = evaluateIds(cards, cards.length);
    const under = below(score);
    const equal = below(score + 1) - under;
    const percentile = (under + equal / 2) / scores.length;
    cache.set(key, percentile);
    return percentile;
  };
}

/** Share of a range that bets or raises for value at a given size; larger bets come from stronger hands. */
export function valueShare(kind: 'bet' | 'raise', fraction: number): number {
  return kind === 'bet' ? clamp(0.62 - 0.2 * fraction, 0.25, 0.58) : clamp(0.36 - 0.1 * fraction, 0.12, 0.3);
}

/**
 * Share of a range that calls a bet of the given size: clearly more than the share that keeps bluffs from profiting,
 * and never less than about half, because players call bets, and large bets especially, more often than that balance
 * suggests.
 */
export function callShare(fraction: number): number {
  return clamp(1.4 / (1 + fraction), 0.45, 0.9);
}

/** Bets above the pot carry fewer bluffs: players rarely risk that much without a hand. */
const bluffScale = (fraction: number): number => Math.min(1, 2 / (1 + fraction));

/**
 * Weight of a holding at board percentile `percentile` after one postflop action. Bets and raises keep a share of
 * bluffs and draws; calls keep some draws. `river` marks the last street, where draws no longer exist.
 */
export function actionWeight(action: PostflopRead, percentile: number, river: boolean): number {
  switch (action.kind) {
    case 'bet':
      return percentile >= 1 - valueShare('bet', action.fraction) ? 1 : (river ? 0.12 : 0.2) * bluffScale(action.fraction);
    case 'raise':
      return percentile >= 1 - valueShare('raise', action.fraction) ? 1 : (river ? 0.06 : 0.12) * bluffScale(action.fraction);
    case 'call':
      return percentile >= 1 - callShare(action.fraction) ? 1 : river ? 0.08 : 0.3;
    case 'check':
      // Checking caps a range a little: the very best hands usually bet.
      return percentile >= 0.93 ? 0.6 : 1;
  }
}
