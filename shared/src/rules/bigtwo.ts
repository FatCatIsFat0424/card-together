// ─── Taiwanese Big Two rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#big-two

import type { Card, Rank, Seat, Suit } from '../types';
import { SEAT_ORDER_CLOCKWISE } from '../constants';

export type BigTwoComboType = 'single' | 'pair' | 'straight' | 'fullHouse' | 'fourOfAKind' | 'straightFlush';

export interface BigTwoCombo {
  readonly type: BigTwoComboType;
  readonly cards: Card[];
  /** Comparison key within the same hand type; larger is stronger */
  readonly key: number;
}

/** Ranks low to high: 3, 4, ..., K, A, 2 */
export const BIGTWO_RANK_ORDER: readonly number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

/** Suits low to high: ♣ < ♦ < ♥ < ♠ */
export const BIGTWO_SUIT_ORDER: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

/** Straights low to high in BIGTWO ranks (A2345 ... 10JQKA); the last card is the comparison card */
const STRAIGHTS: readonly (readonly Rank[])[] = [
  [14, 2, 3, 4, 5],
  [2, 3, 4, 5, 6],
  [3, 4, 5, 6, 7],
  [4, 5, 6, 7, 8],
  [5, 6, 7, 8, 9],
  [6, 7, 8, 9, 10],
  [7, 8, 9, 10, 11],
  [8, 9, 10, 11, 12],
  [9, 10, 11, 12, 13],
  [10, 11, 12, 13, 14],
];

const COMBO_ORDER: readonly BigTwoComboType[] = ['single', 'pair', 'straight', 'fullHouse', 'fourOfAKind', 'straightFlush'];

function rankValue(rank: Rank): number {
  return BIGTWO_RANK_ORDER.indexOf(rank);
}

function suitValue(suit: Suit): number {
  return BIGTWO_SUIT_ORDER.indexOf(suit);
}

function cardKey(card: Card): number {
  return rankValue(card.rank) * 4 + suitValue(card.suit);
}

export function compareBigTwoCards(a: Card, b: Card): number {
  return cardKey(a) - cardKey(b);
}

export function sortBigTwoHand(cards: readonly Card[], by: 'rank' | 'suit' = 'rank'): Card[] {
  if (by === 'rank') return [...cards].sort(compareBigTwoCards);
  return [...cards].sort((a, b) => suitValue(a.suit) - suitValue(b.suit) || rankValue(a.rank) - rankValue(b.rank));
}

/** Returns the straight index (A2345 = 0 ... 10JQKA = 9) and comparison card, or null if not a straight */
function straightOf(cards: readonly Card[]): { index: number; last: Card } | null {
  const index = STRAIGHTS.findIndex((ranks) => ranks.every((rank) => cards.some((card) => card.rank === rank)));
  if (index < 0) return null;
  const lastRank = STRAIGHTS[index][4];
  const last = cards.find((card) => card.rank === lastRank);
  return last ? { index, last } : null;
}

function rankCounts(cards: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return counts;
}

export function identifyCombo(cards: readonly Card[]): BigTwoCombo | null {
  const unique = new Set(cards.map((card) => `${card.suit}-${card.rank}`));
  if (unique.size !== cards.length) return null;
  const sorted = sortBigTwoHand(cards);
  const top = sorted[sorted.length - 1];

  if (cards.length === 1) return { type: 'single', cards: sorted, key: cardKey(top) };
  if (cards.length === 2) {
    return sorted[0].rank === top.rank ? { type: 'pair', cards: sorted, key: cardKey(top) } : null;
  }
  if (cards.length !== 5) return null;

  const straight = straightOf(sorted);
  if (straight) {
    const flush = sorted.every((card) => card.suit === top.suit);
    const key = straight.index * 4 + suitValue(straight.last.suit);
    return { type: flush ? 'straightFlush' : 'straight', cards: sorted, key };
  }

  const groups = [...rankCounts(sorted).entries()].sort((a, b) => b[1] - a[1]);
  if (groups[0][1] === 4) return { type: 'fourOfAKind', cards: sorted, key: rankValue(groups[0][0]) };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { type: 'fullHouse', cards: sorted, key: rankValue(groups[0][0]) };
  return null;
}

export function isBomb(combo: BigTwoCombo): boolean {
  return combo.type === 'fourOfAKind' || combo.type === 'straightFlush';
}

export function beats(next: BigTwoCombo, previous: BigTwoCombo): boolean {
  if (isBomb(next) && !isBomb(previous)) return true;
  if (isBomb(next) && next.type !== previous.type) return next.type === 'straightFlush';
  return next.type === previous.type && next.key > previous.key;
}

function containsClubThree(cards: readonly Card[]): boolean {
  return cards.some((card) => card.suit === 'clubs' && card.rank === 3);
}

export function canPlay(cards: readonly Card[], previous: BigTwoCombo | null, mustContainClubThree: boolean): boolean {
  const combo = identifyCombo(cards);
  if (!combo) return false;
  if (mustContainClubThree && !containsClubThree(cards)) return false;
  return previous === null || beats(combo, previous);
}

/** Dragon: all 13 ranks 3...2, one card each */
export function isDragon(hand: readonly Card[]): boolean {
  return hand.length === 13 && rankCounts(hand).size === 13;
}

/** Remaining cards × 2^(number of twos left) */
export function bigTwoPenalty(hand: readonly Card[]): number {
  return hand.length * 2 ** hand.filter((card) => card.rank === 2).length;
}

export function findClubThreeHolder(hands: Record<Seat, readonly Card[]>): Seat {
  const holder = SEAT_ORDER_CLOCKWISE.find((seat) => containsClubThree(hands[seat]));
  if (!holder) throw new Error('No player holds the three of clubs');
  return holder;
}

function subsets(cards: readonly Card[], size: number): Card[][] {
  if (size === 0) return [[]];
  const result: Card[][] = [];
  for (let i = 0; i <= cards.length - size; i++) {
    for (const rest of subsets(cards.slice(i + 1), size - 1)) result.push([cards[i], ...rest]);
  }
  return result;
}

/** All legal plays for a hand, weakest to strongest (bombs last) */
export function legalPlays(hand: readonly Card[], previous: BigTwoCombo | null, mustContainClubThree: boolean): BigTwoCombo[] {
  const sorted = sortBigTwoHand(hand);
  const plays: BigTwoCombo[] = [];
  for (const size of [1, 2, 5]) {
    for (const cards of subsets(sorted, size)) {
      if (!canPlay(cards, previous, mustContainClubThree)) continue;
      const combo = identifyCombo(cards);
      if (combo) plays.push(combo);
    }
  }
  return plays.sort((a, b) => COMBO_ORDER.indexOf(a.type) - COMBO_ORDER.indexOf(b.type) || a.key - b.key);
}
