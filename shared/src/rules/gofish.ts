// ─── Go Fish rules (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#釣魚

import type { Card, GameSeat, Rank } from '../types';
import type { GoFishMatchResult } from '../games/gofish/types';
import { GAME_SEAT_ORDER, RANK_ORDER_DESC } from '../constants';

/** Hands in one match; the most books over all hands win. */
export const GF_HANDS = 3;

/** Every rank forms one book, so a hand ends after this many. */
export const GF_BOOKS_PER_HAND = RANK_ORDER_DESC.length;

export const GF_BOOK_SIZE = 4;

/** Seven cards for two or three players, five otherwise. */
export function gfHandSize(players: number): number {
  return players <= 3 ? 7 : 5;
}

export function gfCount(hand: readonly Card[], rank: Rank): number {
  return hand.filter((card) => card.rank === rank).length;
}

/** Ranks in `hand`, highest first. */
export function gfRanks(hand: readonly Card[]): Rank[] {
  return RANK_ORDER_DESC.filter((rank) => hand.some((card) => card.rank === rank));
}

/** Ranks for which `hand` holds a whole book, highest first. */
export function gfCompleteBooks(hand: readonly Card[]): Rank[] {
  return RANK_ORDER_DESC.filter((rank) => gfCount(hand, rank) >= GF_BOOK_SIZE);
}

/** Seats that can be asked: every other seat that still holds cards. */
export function gfTargets(
  seats: readonly GameSeat[], handCounts: Readonly<Record<GameSeat, number>>, seat: GameSeat,
): GameSeat[] {
  return seats.filter((other) => other !== seat && handCounts[other] > 0);
}

/** Next seat in `seats` after `seat`, in seat order. */
export function gfNextSeat(seats: readonly GameSeat[], seat: GameSeat): GameSeat {
  const size = GAME_SEAT_ORDER.length;
  let index = GAME_SEAT_ORDER.indexOf(seat);
  do index = (index + 1) % size; while (!seats.includes(GAME_SEAT_ORDER[index]));
  return GAME_SEAT_ORDER[index];
}

/** Seats with the highest total. */
export function gfLeaders(seats: readonly GameSeat[], scores: Readonly<Record<GameSeat, number>>): GameSeat[] {
  const best = Math.max(...seats.map((seat) => scores[seat]));
  return seats.filter((seat) => scores[seat] === best);
}

/** Competition ranking by total: seats on the same total share a rank. */
export function gfRank(result: GoFishMatchResult, seat: GameSeat): number {
  const seats = result.seats ?? [];
  return 1 + seats.filter((other) => result.scores[other] > result.scores[seat]).length;
}
