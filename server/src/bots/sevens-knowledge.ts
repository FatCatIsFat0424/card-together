import type { Card, Seat, SevensVisibleState, Suit } from '@shared/types';
import { SEAT_ORDER_CLOCKWISE } from '@shared/constants';
import { svApply, svEmptyTable, svIsPlayable, svTableCards } from '@shared/rules/sevens';
import type { SevensTable } from '@shared/types';

/** Suits in card-index order: index = suit * 13 + order - 1, with A = order 1. */
export const SV_SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export const SV_CARDS = 52;

export function svIndex(card: Card): number {
  return SV_SUITS.indexOf(card.suit) * 13 + (card.rank === 14 ? 0 : card.rank - 1);
}

export function svCardAt(index: number): Card {
  const order = (index % 13) + 1;
  return { suit: SV_SUITS[Math.floor(index / 13)], rank: (order === 1 ? 14 : order) as Card['rank'] };
}

/** What a seat's forced covers prove: cards playable at a cover were not in that hand then, nor later. */
export interface SevensSeatConstraints {
  /** 1 for a card the seat's current hand cannot hold. */
  readonly hand: Uint8Array;
  /** Per cover in order: 1 for a card that cover cannot be (playable at that cover or an earlier one). */
  readonly covers: readonly Uint8Array[];
}

/**
 * Replays the public log. No card is ever drawn, so a card playable when a seat had to cover was absent from
 * its hand at that moment and stays absent afterwards; a card it covered later was in that hand, so it obeys
 * every earlier exclusion too. Covers made automatically after the last close carry no information.
 */
export function sevensCoverConstraints(visible: SevensVisibleState): Record<Seat, SevensSeatConstraints> {
  const closeOnEnd = visible.options?.closeOnEnd ?? false;
  const running = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, new Uint8Array(SV_CARDS)])) as Record<Seat, Uint8Array>;
  const covers = Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, [] as Uint8Array[]])) as Record<Seat, Uint8Array[]>;
  let table: SevensTable = svEmptyTable();
  let firstPlay = true;
  for (const entry of visible.log) {
    if (entry.type === 'play') {
      table = svApply(table, entry.card, closeOnEnd);
      firstPlay = false;
      continue;
    }
    const excluded = running[entry.seat];
    for (let index = 0; index < SV_CARDS; index++) {
      if (svIsPlayable(table, svCardAt(index), firstPlay, closeOnEnd)) excluded[index] = 1;
    }
    covers[entry.seat].push(excluded.slice());
  }
  const result = {} as Record<Seat, SevensSeatConstraints>;
  for (const seat of SEAT_ORDER_CLOCKWISE) result[seat] = { hand: running[seat], covers: covers[seat] };
  return result;
}

/** Cards nobody has shown to this seat: neither on the table nor in its own hand or covers. */
export function sevensUnseen(visible: SevensVisibleState): number[] {
  const seen = new Uint8Array(SV_CARDS);
  for (const card of [...visible.myHand, ...visible.myCovered, ...svTableCards(visible.table)]) seen[svIndex(card)] = 1;
  const unseen: number[] = [];
  for (let index = 0; index < SV_CARDS; index++) if (!seen[index]) unseen.push(index);
  return unseen;
}

/**
 * Players tend to cover their cheapest dead cards, so an opponent's cover is weighted toward low cards by
 * `exp(-COVER_LOW_BIAS * order)`. Shared with the search's deal sampler.
 */
export const COVER_LOW_BIAS = 0.12;

export interface SevensKnowledge {
  readonly liveProbabilities: ReadonlyMap<string, Readonly<Record<Seat, number>>>;
}

function cardKey(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

const SINKHORN_ROUNDS = 40;

/**
 * Estimates where each unseen card is: in one opponent's hand, or among one opponent's covers. Every card
 * must be somewhere and every hand and cover holds its known count, so the estimate scales the allowed cells
 * until rows and columns both match (iterative proportional fitting): an exclusion on one seat raises the
 * others' share, and a cover's exclusions are honored per cover rather than spread uniformly.
 */
export function buildSevensKnowledge(visible: SevensVisibleState): SevensKnowledge {
  const constraints = sevensCoverConstraints(visible);
  const opponents = SEAT_ORDER_CLOCKWISE.filter((seat) => seat !== visible.mySeat);
  const unseen = sevensUnseen(visible);
  // Columns: each opponent's hand, then one column per opponent cover.
  const columns: { seat: Seat; hand: boolean; size: number; excluded: Uint8Array }[] = [];
  for (const seat of opponents) {
    columns.push({ seat, hand: true, size: visible.handCounts[seat], excluded: constraints[seat].hand });
  }
  for (const seat of opponents) {
    const known = constraints[seat].covers;
    for (let index = 0; index < visible.coveredCounts[seat]; index++) {
      columns.push({ seat, hand: false, size: 1, excluded: known[index] ?? new Uint8Array(SV_CARDS) });
    }
  }
  const matrix = unseen.map((card) => columns.map((column) => {
    if (column.excluded[card] || column.size === 0) return 0;
    return column.hand ? 1 : Math.exp(-COVER_LOW_BIAS * ((card % 13) + 1));
  }));
  for (let round = 0; round < SINKHORN_ROUNDS; round++) {
    columns.forEach((column, col) => {
      const total = matrix.reduce((sum, row) => sum + row[col], 0);
      if (total > 0) for (const row of matrix) row[col] *= column.size / total;
    });
    // Rows last, so each card's shares sum to one even on a view whose counts do not add up.
    for (const row of matrix) {
      const total = row.reduce((sum, value) => sum + value, 0);
      if (total > 0) for (let col = 0; col < row.length; col++) row[col] /= total;
    }
  }

  const liveProbabilities = new Map<string, Readonly<Record<Seat, number>>>();
  for (const card of visible.myHand) {
    const probabilities: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
    probabilities[visible.mySeat] = 1;
    liveProbabilities.set(cardKey(card), probabilities);
  }
  unseen.forEach((card, row) => {
    const probabilities: Record<Seat, number> = { N: 0, E: 0, S: 0, W: 0 };
    columns.forEach((column, col) => {
      if (column.hand) probabilities[column.seat] += matrix[row][col];
    });
    liveProbabilities.set(cardKey(svCardAt(card)), probabilities);
  });
  return { liveProbabilities };
}

/** Probability that the card remains in any hand, including an unreachable card. */
export function sevensLiveProbability(knowledge: SevensKnowledge, card: Card): number {
  const probabilities = knowledge.liveProbabilities.get(cardKey(card));
  return probabilities ? SEAT_ORDER_CLOCKWISE.reduce((total, seat) => total + probabilities[seat], 0) : 0;
}

export function sevensLiveProbabilityAt(knowledge: SevensKnowledge, card: Card, seat: Seat): number {
  return knowledge.liveProbabilities.get(cardKey(card))?.[seat] ?? 0;
}
