// ─── Pure Chinese Poker view helpers (no React) ───

import { SUIT_DISPLAY_ORDER } from '@shared/constants';
import {
  CP_ROWS, CP_ROW_SIZES, cpCompare, cpEvaluate, cpIsFoul, cpRowValue, cpSortHand,
} from '@shared/rules/chinesepoker';
import type {
  Card, ChinesePokerArrangement, ChinesePokerCategory, ChinesePokerMatchup, ChinesePokerRow, Seat,
} from '@shared/types';
import type { ChinesePokerTranslationKey } from '../../chinesepoker-i18n';

/** Cards the player has placed in each row while arranging */
export type CpRowCards = Readonly<Record<ChinesePokerRow, readonly Card[]>>;

export const EMPTY_ROWS: CpRowCards = { front: [], middle: [], back: [] };

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function containsCard(cards: readonly Card[], card: Card): boolean {
  return cards.some((candidate) => sameCard(candidate, card));
}

export function categoryLabelKey(category: ChinesePokerCategory): ChinesePokerTranslationKey {
  return `chinesepoker.category.${category}`;
}

export function rowLabelKey(row: ChinesePokerRow): ChinesePokerTranslationKey {
  return `chinesepoker.row.${row}`;
}

/** Signed score text; zero has no sign. */
export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

/** Rank order keeps the server's high-to-low display; suit order groups suits, high to low within each. */
export function sortCpHand(cards: readonly Card[], by: 'rank' | 'suit'): Card[] {
  if (by === 'rank') return cpSortHand(cards);
  return [...cards].sort((a, b) =>
    SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit) || b.rank - a.rank);
}

/** Drops cards that are not in the dealt hand, duplicates, and anything beyond a row's capacity. */
export function sanitizeRows(rows: CpRowCards, hand: readonly Card[]): CpRowCards {
  const used: Card[] = [];
  const keep = (row: ChinesePokerRow): Card[] => {
    const kept: Card[] = [];
    for (const card of rows[row]) {
      if (kept.length >= CP_ROW_SIZES[row] || !containsCard(hand, card) || containsCard(used, card)) continue;
      kept.push(card);
      used.push(card);
    }
    return kept;
  };
  return { front: keep('front'), middle: keep('middle'), back: keep('back') };
}

export function placedCount(rows: CpRowCards): number {
  return rows.front.length + rows.middle.length + rows.back.length;
}

/** Dealt cards not yet placed in any row, in hand order */
export function unplacedCards(hand: readonly Card[], rows: CpRowCards): Card[] {
  const placed = [...rows.front, ...rows.middle, ...rows.back];
  return hand.filter((card) => !containsCard(placed, card));
}

export function rowSpace(rows: CpRowCards, row: ChinesePokerRow): number {
  return CP_ROW_SIZES[row] - rows[row].length;
}

/** Cards can move into a row when there are some and the row has room for all of them. */
export function canPlace(rows: CpRowCards, row: ChinesePokerRow, cards: readonly Card[]): boolean {
  const incoming = cards.filter((card) => !containsCard(rows[row], card));
  return incoming.length > 0 && incoming.length <= rowSpace(rows, row);
}

/** Moves the cards into the row (taking them out of any other row); unchanged when they do not fit. */
export function placeCards(rows: CpRowCards, row: ChinesePokerRow, cards: readonly Card[]): CpRowCards {
  if (!canPlace(rows, row, cards)) return rows;
  const incoming = cards.filter((card) => !containsCard(rows[row], card));
  const without = (target: ChinesePokerRow): Card[] =>
    rows[target].filter((card) => !containsCard(incoming, card));
  return {
    front: row === 'front' ? [...rows.front, ...incoming] : without('front'),
    middle: row === 'middle' ? [...rows.middle, ...incoming] : without('middle'),
    back: row === 'back' ? [...rows.back, ...incoming] : without('back'),
  };
}

/** Takes the card out of whichever row holds it. */
export function returnCard(rows: CpRowCards, card: Card): CpRowCards {
  const without = (row: ChinesePokerRow): readonly Card[] => rows[row].filter((candidate) => !sameCard(candidate, card));
  return { front: without('front'), middle: without('middle'), back: without('back') };
}

export function rowsFromArrangement(arrangement: ChinesePokerArrangement): CpRowCards {
  return { front: [...arrangement.front], middle: [...arrangement.middle], back: [...arrangement.back] };
}

/** The arrangement to submit, or null until every row is full */
export function buildArrangement(rows: CpRowCards): ChinesePokerArrangement | null {
  if (CP_ROWS.some((row) => rows[row].length !== CP_ROW_SIZES[row])) return null;
  const copy = (cards: readonly Card[]): Card[] => cards.map(({ suit, rank }) => ({ suit, rank }));
  return { front: copy(rows.front), middle: copy(rows.middle), back: copy(rows.back) };
}

/** True only for a complete arrangement whose rows are out of order (倒水) */
export function isFoulArrangement(rows: CpRowCards): boolean {
  const arrangement = buildArrangement(rows);
  return arrangement !== null && cpIsFoul(arrangement);
}

export interface CpRowHint {
  /** Category once the row is full */
  readonly category: ChinesePokerCategory | null;
  /** Points the row earns when it wins, shown only above the base value of 1 */
  readonly value: number;
  /** A full row below that this row already beats, which makes the arrangement a foul */
  readonly beats: ChinesePokerRow | null;
}

/** Live labels for each row; a row is compared with the nearest full row below it. */
export function rowHints(rows: CpRowCards): Record<ChinesePokerRow, CpRowHint> {
  const evaluation = (row: ChinesePokerRow): ReturnType<typeof cpEvaluate> | null =>
    rows[row].length === CP_ROW_SIZES[row] ? cpEvaluate(rows[row]) : null;
  const evaluations = { front: evaluation('front'), middle: evaluation('middle'), back: evaluation('back') };
  const hint = (row: ChinesePokerRow): CpRowHint => {
    const own = evaluations[row];
    if (!own) return { category: null, value: 1, beats: null };
    const below = CP_ROWS.slice(CP_ROWS.indexOf(row) + 1).find((candidate) => evaluations[candidate] !== null);
    const lower = below ? evaluations[below] : null;
    return {
      category: own.category,
      value: cpRowValue(row, own),
      beats: below && lower && cpCompare(own, lower) > 0 ? below : null,
    };
  };
  return { front: hint('front'), middle: hint('middle'), back: hint('back') };
}

/** Each seat's net points for one row against all three opponents, before sweep multipliers */
export function rowNet(matchups: readonly ChinesePokerMatchup[], row: ChinesePokerRow): Record<Seat, number> {
  const index = CP_ROWS.indexOf(row);
  const net: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const { seats, rows } of matchups) {
    net[seats[0]] += rows[index];
    net[seats[1]] -= rows[index];
  }
  return net;
}
