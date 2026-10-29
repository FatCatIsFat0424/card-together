// ─── Old Maid rules (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#抽鬼牌

import type { Card, CardOrJoker, GameSeat } from '../types';
import { createJokerDeck, isJoker } from './cards';

/** Deals per match; the first drawer rotates through the seats. */
export const OM_DEALS = 3;

/** The 52 suit cards plus one joker. */
export function omDeck(): CardOrJoker[] {
  return createJokerDeck(1);
}

/** Fisher-Yates over a copy; `random` returns a number in [0, 1). */
export function omShuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Deals every card one at a time, starting with the first seat. */
export function omDealHands(deck: readonly CardOrJoker[], seats: readonly GameSeat[]): Map<GameSeat, CardOrJoker[]> {
  const hands = new Map<GameSeat, CardOrJoker[]>(seats.map((seat) => [seat, []]));
  deck.forEach((card, index) => hands.get(seats[index % seats.length])?.push(card));
  return hands;
}

export interface PairDiscard {
  /** Cards still held, in their original order */
  readonly kept: CardOrJoker[];
  /** Discarded cards, two per pair of equal rank */
  readonly pairs: Card[];
}

/** Removes every pair of equal rank; the joker never pairs. A rank held four times discards two pairs. */
export function omDiscardPairs(hand: readonly CardOrJoker[]): PairDiscard {
  const open = new Map<number, number>();
  const gone = new Set<number>();
  const pairs: Card[] = [];
  hand.forEach((card, index) => {
    if (isJoker(card)) return;
    const partner = open.get(card.rank);
    if (partner === undefined) {
      open.set(card.rank, index);
      return;
    }
    open.delete(card.rank);
    gone.add(partner);
    gone.add(index);
    pairs.push(hand[partner] as Card, card);
  });
  return { kept: hand.filter((_card, index) => !gone.has(index)), pairs };
}

/** The first seat after `seat`, in table order, that still holds cards. */
export function omNextHolder(
  seat: GameSeat, seats: readonly GameSeat[], counts: Readonly<Record<GameSeat, number>>,
): GameSeat | null {
  const start = seats.indexOf(seat);
  for (let step = 1; step < seats.length; step++) {
    const candidate = seats[(start + step) % seats.length];
    if (counts[candidate] > 0) return candidate;
  }
  return null;
}

/** `order` lists every index of a hand of `length` cards exactly once. */
export function omIsPermutation(order: readonly number[], length: number): boolean {
  return order.length === length && new Set(order).size === length
    && order.every((index) => Number.isInteger(index) && index >= 0 && index < length);
}

/** `hand` rearranged so position `i` holds the card that was at `order[i]`. */
export function omApplyOrder<T>(hand: readonly T[], order: readonly number[]): T[] {
  return order.map((index) => hand[index]);
}

/** A uniformly random permutation of `length` indices. */
export function omRandomOrder(length: number, random: () => number): number[] {
  return omShuffle(Array.from({ length }, (_value, index) => index), random);
}

/** Points for finishing a deal in `place` (1 is first out) among `players`; the joker holder places last and scores 0. */
export function omPlacePoints(players: number, place: number): number {
  return Math.max(0, players - place);
}

/** Seats with the most points, in table order. */
export function omWinners(
  totals: Readonly<Record<GameSeat, number>>, seats: readonly GameSeat[],
): GameSeat[] {
  const best = Math.max(...seats.map((seat) => totals[seat]));
  return seats.filter((seat) => totals[seat] === best);
}

/** The seat that opens deal `deal` (1-based). */
export function omStarter(deal: number, seats: readonly GameSeat[]): GameSeat {
  return seats[(deal - 1) % seats.length];
}

/** Ranks of the cards already discarded, counted by rank. */
export function omDiscardedRanks(cards: readonly Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return counts;
}
