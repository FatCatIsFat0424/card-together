// ─── Chinese Poker (13 cards) rules engine (pure functions, shared by client and server) ───
// Rules: docs/games.md#chinese-poker

import type {
  Card,
  ChinesePokerArrangement,
  ChinesePokerCategory,
  ChinesePokerMatchResult,
  ChinesePokerMatchup,
  ChinesePokerRow,
  Seat,
} from '../types';
import { RANK_ORDER_DESC, SEAT_ORDER_CLOCKWISE, SUIT_DISPLAY_ORDER } from '../constants';

export const CP_ROWS: readonly ChinesePokerRow[] = ['front', 'middle', 'back'];
export const CP_ROW_SIZES: Record<ChinesePokerRow, number> = { front: 3, middle: 5, back: 5 };
export const CP_HAND_SIZE = 13;
/** Arranging 13 cards takes longer than a normal turn, so the shared deadline never drops below this. */
export const CP_MIN_ARRANGE_SECONDS = 60;

/** Categories low to high */
export const CP_CATEGORY_ORDER: readonly ChinesePokerCategory[] = [
  'highCard', 'pair', 'twoPair', 'threeOfAKind', 'straight', 'flush', 'fullHouse', 'fourOfAKind', 'straightFlush',
];

export interface CpEvaluation {
  readonly category: ChinesePokerCategory;
  /** Tie-break ranks, most significant first (A=14 … 2) */
  readonly ranks: number[];
}

/** The six pairings in N/E/S/W pair order */
export const CP_PAIRINGS: readonly (readonly [Seat, Seat])[] = [
  ['N', 'E'], ['N', 'S'], ['N', 'W'], ['E', 'S'], ['E', 'W'], ['S', 'W'],
];

/** High to low by rank, then by display suit, for showing a dealt hand */
export function cpSortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank
    || SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit));
}

/** Rank groups ordered by size, then rank, both descending */
function rankGroups(cards: readonly Card[]): { rank: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
}

/** Top card of a five-rank straight; A2345 counts as 5-high and nothing wraps past the ace. */
function straightTop(descending: readonly number[]): number | null {
  if (descending.length !== 5 || new Set(descending).size !== 5) return null;
  if (descending[0] - descending[4] === 4) return descending[0];
  return descending.join() === '14,5,4,3,2' ? 5 : null;
}

/** Evaluates a 3-card front or a 5-card middle/back; a front never forms straights or flushes. */
export function cpEvaluate(cards: readonly Card[]): CpEvaluation {
  if (cards.length !== 3 && cards.length !== 5) throw new RangeError('A row has 3 or 5 cards');
  const groups = rankGroups(cards);
  const grouped = groups.map((group) => group.rank);
  if (cards.length === 3) {
    if (groups[0].count === 3) return { category: 'threeOfAKind', ranks: grouped };
    return { category: groups[0].count === 2 ? 'pair' : 'highCard', ranks: grouped };
  }

  const descending = cards.map((card) => card.rank).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const top = straightTop(descending);
  if (top !== null) return { category: flush ? 'straightFlush' : 'straight', ranks: [top] };
  if (groups[0].count === 4) return { category: 'fourOfAKind', ranks: grouped };
  if (groups[0].count === 3 && groups[1].count === 2) return { category: 'fullHouse', ranks: grouped };
  if (flush) return { category: 'flush', ranks: descending };
  if (groups[0].count === 3) return { category: 'threeOfAKind', ranks: grouped };
  if (groups[0].count === 2 && groups[1].count === 2) return { category: 'twoPair', ranks: grouped };
  return { category: groups[0].count === 2 ? 'pair' : 'highCard', ranks: grouped };
}

/**
 * Category first, then ranks lexicographically. Vectors of different lengths (front against middle)
 * compare only over the shorter one, so a front equals a middle that extends it.
 */
export function cpCompare(a: CpEvaluation, b: CpEvaluation): -1 | 0 | 1 {
  const category = CP_CATEGORY_ORDER.indexOf(a.category) - CP_CATEGORY_ORDER.indexOf(b.category);
  if (category !== 0) return category > 0 ? 1 : -1;
  const length = Math.min(a.ranks.length, b.ranks.length);
  for (let i = 0; i < length; i++) {
    if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] > b.ranks[i] ? 1 : -1;
  }
  return 0;
}

/** Foul (倒水) unless back ≥ middle ≥ front */
export function cpIsFoul(arrangement: ChinesePokerArrangement): boolean {
  const middle = cpEvaluate(arrangement.middle);
  return cpCompare(middle, cpEvaluate(arrangement.back)) > 0
    || cpCompare(cpEvaluate(arrangement.front), middle) > 0;
}

/** Points a row is worth to the player who wins it with this hand */
export function cpRowValue(row: ChinesePokerRow, evaluation: CpEvaluation): number {
  const { category } = evaluation;
  if (row === 'front') return category === 'threeOfAKind' ? 3 : 1;
  if (row === 'middle') {
    if (category === 'straightFlush') return 10;
    if (category === 'fourOfAKind') return 8;
    return category === 'fullHouse' ? 2 : 1;
  }
  if (category === 'straightFlush') return 5;
  return category === 'fourOfAKind' ? 4 : 1;
}

const cardKey = (card: Card): string => `${card.suit}-${card.rank}`;

function isWellFormedCard(card: unknown): card is Card {
  if (typeof card !== 'object' || card === null) return false;
  const { suit, rank } = card as Record<string, unknown>;
  return SUIT_DISPLAY_ORDER.some((known) => known === suit)
    && RANK_ORDER_DESC.some((known) => known === rank);
}

/** Rows of 3/5/5 that use exactly the 13 dealt cards, each once */
export function cpIsValidArrangement(hand: readonly Card[], arrangement: ChinesePokerArrangement): boolean {
  if (hand.length !== CP_HAND_SIZE || typeof arrangement !== 'object' || arrangement === null) return false;
  const dealt = new Set(hand.map(cardKey));
  if (dealt.size !== CP_HAND_SIZE) return false;
  const used = new Set<string>();
  for (const row of CP_ROWS) {
    const cards: unknown = arrangement[row];
    if (!Array.isArray(cards) || cards.length !== CP_ROW_SIZES[row]) return false;
    for (const card of cards as unknown[]) {
      if (!isWellFormedCard(card)) return false;
      const key = cardKey(card);
      if (!dealt.has(key) || used.has(key)) return false;
      used.add(key);
    }
  }
  return used.size === CP_HAND_SIZE;
}

/** Deep copy holding only each card's suit and rank */
export function cpCopyArrangement(arrangement: ChinesePokerArrangement): ChinesePokerArrangement {
  const copy = (cards: readonly Card[]): Card[] => cards.map(({ suit, rank }) => ({ suit, rank }));
  return { front: copy(arrangement.front), middle: copy(arrangement.middle), back: copy(arrangement.back) };
}

type RowEvaluations = Record<ChinesePokerRow, CpEvaluation>;

/** Signed row points from `a`'s side; a fouled seat loses every row to a clean one at the winner's values. */
function rowPoints(a: RowEvaluations, aFoul: boolean, b: RowEvaluations, bFoul: boolean): [number, number, number] {
  const points = CP_ROWS.map((row) => {
    if (aFoul && bFoul) return 0;
    const comparison = aFoul ? -1 : bFoul ? 1 : cpCompare(a[row], b[row]);
    if (comparison > 0) return cpRowValue(row, a[row]);
    return comparison < 0 ? -cpRowValue(row, b[row]) : 0;
  });
  return [points[0], points[1], points[2]];
}

function seatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

/** Pairwise scoring with shoot (打槍) and home-run (全壘打) doubling */
export function cpMatchResult(arrangements: Record<Seat, ChinesePokerArrangement>): ChinesePokerMatchResult {
  const evaluations = seatMap((seat): RowEvaluations => ({
    front: cpEvaluate(arrangements[seat].front),
    middle: cpEvaluate(arrangements[seat].middle),
    back: cpEvaluate(arrangements[seat].back),
  }));
  const fouls = SEAT_ORDER_CLOCKWISE.filter((seat) => cpIsFoul(arrangements[seat]));

  const pairings = CP_PAIRINGS.map(([first, second]) => {
    const rows = rowPoints(evaluations[first], fouls.includes(first), evaluations[second], fouls.includes(second));
    const shooter = rows.every((points) => points > 0) ? first : rows.every((points) => points < 0) ? second : null;
    const raw = rows[0] + rows[1] + rows[2];
    return { seats: [first, second] as const, rows, shooter, raw: shooter ? raw * 2 : raw };
  });
  // Shooting all three opponents excludes anyone else doing so, so at most one seat qualifies.
  const homeRun = SEAT_ORDER_CLOCKWISE.find((seat) =>
    pairings.filter((pairing) => pairing.shooter === seat).length === SEAT_ORDER_CLOCKWISE.length - 1) ?? null;

  const scores = seatMap(() => 0);
  const matchups = pairings.map(({ seats, rows, shooter, raw }): ChinesePokerMatchup => {
    const points = homeRun !== null && seats.includes(homeRun) ? raw * 2 : raw;
    scores[seats[0]] += points;
    scores[seats[1]] -= points;
    return { seats, rows, shooter, points };
  });
  const best = Math.max(...SEAT_ORDER_CLOCKWISE.map((seat) => scores[seat]));

  return {
    gameType: 'chinesepoker',
    arrangements: seatMap((seat) => cpCopyArrangement(arrangements[seat])),
    fouls,
    matchups,
    homeRun,
    scores,
    winners: SEAT_ORDER_CLOCKWISE.filter((seat) => scores[seat] === best),
  };
}

/** The whole table shares one deadline: the turn base plus the bank, never under the minimum. */
export function cpArrangeSeconds(baseSeconds: number, bankSeconds: number): number {
  return Math.max(CP_MIN_ARRANGE_SECONDS, baseSeconds + bankSeconds);
}
