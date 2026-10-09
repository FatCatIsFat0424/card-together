// ─── Playing Engine: card-play rules ───

import type {
  Card,
  Seat,
  Suit,
  BidSuit,
  PlayingState,
  TrickRecord,
} from '@shared/types';
import { TOTAL_TRICKS, SEAT_ORDER_CLOCKWISE, TEAM_SEATS } from '@shared/constants';
import { getNextSeat } from './bidding';

/**
 * Create the initial playing state
 */
export function createPlayingState(leadSeat: Seat): PlayingState {
  return {
    currentTrick: {},
    trickLeadSeat: leadSeat,
    currentTurnSeat: leadSeat,
    completedTricks: [],
    trickCountEW: 0,
    trickCountNS: 0,
  };
}

/**
 * Get legal plays (follow-suit rule)
 * - The leader may play any card
 * - Others must follow the lead suit, or play any card if void
 */
export function getValidPlays(
  hand: readonly Card[],
  state: PlayingState,
): Card[] {
  // The leader may play any card
  if (Object.keys(state.currentTrick).length === 0) {
    return [...hand];
  }

  // Get the lead suit
  const leadCard = state.currentTrick[state.trickLeadSeat];
  if (!leadCard) return [...hand];
  const leadSuit = leadCard.suit;

  // Does the hand hold the lead suit?
  const sameSuitCards = hand.filter((c) => c.suit === leadSuit);
  if (sameSuitCards.length > 0) {
    return sameSuitCards;
  }

  // Void in the lead suit: any card is legal
  return [...hand];
}

/**
 * Validate a play
 */
export function validatePlay(
  hand: readonly Card[],
  state: PlayingState,
  seat: Seat,
  card: Card,
): { valid: true } | { valid: false; reason: string } {
  if (seat !== state.currentTurnSeat) {
    return { valid: false, reason: 'Not your turn' };
  }

  // Check the card is in hand
  const hasCard = hand.some((c) => c.suit === card.suit && c.rank === card.rank);
  if (!hasCard) {
    return { valid: false, reason: 'Card not in hand' };
  }

  // Check the follow-suit rule
  const validPlays = getValidPlays(hand, state);
  const isValid = validPlays.some((c) => c.suit === card.suit && c.rank === card.rank);
  if (!isValid) {
    return { valid: false, reason: 'Must follow suit' };
  }

  return { valid: true };
}

/**
 * Apply a play and return the new state
 */
export function applyPlay(
  state: PlayingState,
  seat: Seat,
  card: Card,
): PlayingState {
  const newTrick = { ...state.currentTrick, [seat]: card };
  // A completed trick's next turn is provisional; completeTrick assigns the winner.
  return {
    ...state,
    currentTrick: newTrick,
    currentTurnSeat: getNextSeat(seat),
  };
}

/**
 * Compare two cards within the same trick
 * @param a Card to compare
 * @param b Reference card
 * @param leadSuit Lead suit (the suit led in the trick)
 * @param trumpSuit Trump suit (set by bidding); 'nt' means no trump
 * @returns > 0 if a beats b
 */
export function compareCards(
  a: Card,
  b: Card,
  leadSuit: Suit,
  trumpSuit: BidSuit,
): number {
  const aIsTrump = trumpSuit !== 'nt' && a.suit === trumpSuit;
  const bIsTrump = trumpSuit !== 'nt' && b.suit === trumpSuit;
  const aIsLead = a.suit === leadSuit;
  const bIsLead = b.suit === leadSuit;

  // Trump vs non-trump
  if (aIsTrump && !bIsTrump) return 1;
  if (!aIsTrump && bIsTrump) return -1;

  // Both trump: compare rank
  if (aIsTrump && bIsTrump) return a.rank - b.rank;

  // Lead suit vs other suit
  if (aIsLead && !bIsLead) return 1;
  if (!aIsLead && bIsLead) return -1;

  // Both lead suit: compare rank
  if (aIsLead && bIsLead) return a.rank - b.rank;

  // Neither lead suit nor trump: compare rank (neither can win in practice)
  return 0;
}

/**
 * Determine the trick winner
 */
export function determineTrickWinner(
  trick: Record<Seat, Card>,
  leadSeat: Seat,
  trumpSuit: BidSuit,
): Seat {
  const leadCard = trick[leadSeat];
  const leadSuit = leadCard.suit;

  let winnerSeat = leadSeat;
  let winnerCard = leadCard;

  const seats = SEAT_ORDER_CLOCKWISE;
  const startIdx = seats.indexOf(leadSeat);

  for (let i = 1; i < 4; i++) {
    const seat = seats[(startIdx + i) % 4];
    const card = trick[seat];

    if (compareCards(card, winnerCard, leadSuit, trumpSuit) > 0) {
      winnerSeat = seat;
      winnerCard = card;
    }
  }

  return winnerSeat;
}

/**
 * Complete a trick and update the state
 */
export function completeTrick(
  state: PlayingState,
  winnerSeat: Seat,
  trick: Record<Seat, Card>,
  leadSeat: Seat,
): PlayingState {
  const trickRecord: TrickRecord = {
    cards: trick,
    leadSeat,
    winnerSeat,
  };

  const isWinnerEW = TEAM_SEATS.EW.includes(winnerSeat);

  return {
    currentTrick: {},
    trickLeadSeat: winnerSeat,
    currentTurnSeat: winnerSeat,
    completedTricks: [...state.completedTricks, trickRecord],
    trickCountEW: state.trickCountEW + (isWinnerEW ? 1 : 0),
    trickCountNS: state.trickCountNS + (isWinnerEW ? 0 : 1),
  };
}

/**
 * Check whether the playing phase is over (all 13 tricks done)
 */
export function isPlayingComplete(state: PlayingState): boolean {
  return state.completedTricks.length >= TOTAL_TRICKS;
}

/**
 * Remove one card from a hand
 */
export function removeCardFromHand(hand: readonly Card[], card: Card): Card[] {
  const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
  if (idx === -1) return [...hand];
  const newHand = [...hand];
  newHand.splice(idx, 1);
  return newHand;
}
