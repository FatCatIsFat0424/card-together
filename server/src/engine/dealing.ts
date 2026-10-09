// ─── Dealing Engine: dealing, sorting, weak-hand redeal ───

import type { Card, Seat } from '@shared/types';
import {
  SUIT_DISPLAY_ORDER,
  RANK_ORDER_DESC,
  REDEAL_MAX_POINTS,
  SEAT_ORDER_CLOCKWISE,
  HIGH_CARD_POINTS,
} from '@shared/constants';

/**
 * Deal a shuffled deck to the four players
 * @param deck - 52 cards
 * @returns Hands of the four players (13 cards each)
 */
export function dealCards(deck: readonly Card[]): Record<Seat, Card[]> {
  const hands: Record<Seat, Card[]> = {
    N: [],
    E: [],
    S: [],
    W: [],
  };

  const seats = SEAT_ORDER_CLOCKWISE;
  for (let i = 0; i < deck.length; i++) {
    hands[seats[i % 4]].push(deck[i]);
  }

  return hands;
}

/**
 * Sort a hand by suit order, then by descending rank within a suit
 * Suit order: ♠ → ♥ → ♣ → ♦
 * Rank order: A → K → Q → J → 10 → ... → 2
 */
export function sortHand(hand: readonly Card[]): Card[] {
  return [...hand].sort((a, b) => {
    const suitDiff = SUIT_DISPLAY_ORDER.indexOf(a.suit) - SUIT_DISPLAY_ORDER.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return RANK_ORDER_DESC.indexOf(a.rank) - RANK_ORDER_DESC.indexOf(b.rank);
  });
}

/**
 * Compute a hand's high card points (HCP)
 * A=4, K=3, Q=2, J=1, others 0
 */
export function calculateHandPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + HIGH_CARD_POINTS[card.rank], 0);
}

/**
 * Check whether a hand contains an ace
 */
function hasAce(hand: readonly Card[]): boolean {
  return hand.some((card) => card.rank === 14);
}

/**
 * Check whether a player qualifies for a redeal
 * Condition: no aces and total HCP at most 4
 */
export function isRedealEligible(hand: readonly Card[]): boolean {
  if (hasAce(hand)) return false;
  return calculateHandPoints(hand) <= REDEAL_MAX_POINTS;
}

/**
 * Starting from the given player, check redeal eligibility clockwise
 * Returns the first qualifying seat, or null if none qualify
 */
export function findRedealEligibleSeat(
  hands: Record<Seat, readonly Card[]>,
  startSeat: Seat,
): Seat | null {
  const startIdx = SEAT_ORDER_CLOCKWISE.indexOf(startSeat);

  for (let i = 0; i < 4; i++) {
    const seat = SEAT_ORDER_CLOCKWISE[(startIdx + i) % 4];
    if (isRedealEligible(hands[seat])) {
      return seat;
    }
  }

  return null;
}
