import type { Card } from '@shared/types';
import type { HandFilter } from './holdem-equity';
import { cardId, evaluateIds, rankOfId, suitOfId } from './holdem-evaluator';
import { preflopRankFractionOf } from './holdem-preflop-table';

/** Starting hands within the best `fraction` of all combos, ranked by equity against a random hand. */
export function topHandsFilter(fraction: number): HandFilter {
  return (first, second) => preflopRankFractionOf(rankOfId(first), rankOfId(second), suitOfId(first) === suitOfId(second)) <= fraction;
}

/** Ranks every possible holding on a board once, then builds filters that keep the strongest share of them. */
export function createBoardRanker(board: readonly Card[], dead: readonly Card[]): (keep: number) => HandFilter {
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
  return (keep) => {
    const cutoff = scores[Math.min(scores.length - 1, Math.floor((1 - keep) * scores.length))];
    return (first, second) => {
      cards[0] = first;
      cards[1] = second;
      return evaluateIds(cards, cards.length) >= cutoff;
    };
  };
}

/** A hand must satisfy every present filter; null means no restriction. */
export function allOf(filters: readonly (HandFilter | null)[]): HandFilter | null {
  const present = filters.filter((filter): filter is HandFilter => filter !== null);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return (first, second) => present.every((filter) => filter(first, second));
}
