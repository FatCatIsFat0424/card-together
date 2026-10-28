// ─── Crazy Eights rules (pure functions, shared by client and server) ───
// Rules: docs/games/cards.md#crazy-eights

import type { Card, GameSeat, Suit } from '../types';
import type { CrazyEightsDirection, CrazyEightsEffect, CrazyEightsMatchResult } from '../games/crazyeights/types';
import { GAME_SEAT_ORDER } from '../constants';

/** Hands in one match; the lowest summed remaining-card points win. */
export const CE_HANDS = 3;

export const CE_WILD_RANK = 8;

export const CE_SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];

/** Seven cards heads-up, five otherwise. */
export function ceHandSize(players: number): number {
  return players === 2 ? 7 : 5;
}

/** Five or more players share two decks. */
export function ceDeckCount(players: number): 1 | 2 {
  return players >= 5 ? 2 : 1;
}

export function ceDeckSize(players: number): number {
  return ceDeckCount(players) * 52;
}

/** Remaining-card penalty: 8 = 50, J/Q/K = 10, A = 1, others face value. */
export function ceCardPoints(card: Card): number {
  if (card.rank === CE_WILD_RANK) return 50;
  if (card.rank === 14) return 1;
  return card.rank >= 11 ? 10 : card.rank;
}

export function ceHandPoints(hand: readonly Card[]): number {
  return hand.reduce((sum, card) => sum + ceCardPoints(card), 0);
}

/** An 8 is always playable; any other card must match the active suit or the top card's rank. */
export function ceIsPlayable(card: Card, top: Card, activeSuit: Suit): boolean {
  return card.rank === CE_WILD_RANK || card.suit === activeSuit || card.rank === top.rank;
}

export function cePlayableCards(hand: readonly Card[], top: Card, activeSuit: Suit): Card[] {
  return hand.filter((card) => ceIsPlayable(card, top, activeSuit));
}

export interface CeTurnOptions {
  readonly playable: Card[];
  /** Nothing can be played yet, so one card may be drawn */
  readonly canDraw: boolean;
  /** Drawn already, or nothing can be played or drawn */
  readonly canPass: boolean;
}

/** What the seat on turn may do; `drawable` counts the stock plus the refill below the top discard. */
export function ceTurnOptions(
  hand: readonly Card[], top: Card, activeSuit: Suit, drawn: boolean, drawable: number,
): CeTurnOptions {
  const playable = cePlayableCards(hand, top, activeSuit);
  return {
    playable,
    canDraw: !drawn && playable.length === 0 && drawable > 0,
    canPass: drawn || (playable.length === 0 && drawable === 0),
  };
}

/** An 8 declares a suit, except the last card, which ends the hand. */
export function ceNeedsSuit(card: Card, handSize: number): boolean {
  return card.rank === CE_WILD_RANK && handSize > 1;
}

/** Room option "action cards": 2 draws two, Q skips, A reverses. */
export function ceEffect(card: Card, actionCards: boolean): CrazyEightsEffect | null {
  if (!actionCards) return null;
  if (card.rank === 2) return 'draw';
  if (card.rank === 12) return 'skip';
  return card.rank === 14 ? 'reverse' : null;
}

/** Next seat in `seats` along `direction`; `seats` lists the occupied seats. */
export function ceNextSeat(seats: readonly GameSeat[], seat: GameSeat, direction: CrazyEightsDirection): GameSeat {
  const step = direction === 'ccw' ? -1 : 1;
  const size = GAME_SEAT_ORDER.length;
  let index = GAME_SEAT_ORDER.indexOf(seat);
  do index = (index + step + size) % size; while (!seats.includes(GAME_SEAT_ORDER[index]));
  return GAME_SEAT_ORDER[index];
}

export function ceFlip(direction: CrazyEightsDirection): CrazyEightsDirection {
  return direction === 'ccw' ? 'cw' : 'ccw';
}

/** Seats with the lowest total. */
export function ceLowestSeats(seats: readonly GameSeat[], scores: Readonly<Record<GameSeat, number>>): GameSeat[] {
  const best = Math.min(...seats.map((seat) => scores[seat]));
  return seats.filter((seat) => scores[seat] === best);
}

/** Competition ranking by total: seats on the same total share a rank. */
export function ceRank(result: CrazyEightsMatchResult, seat: GameSeat): number {
  const seats = result.seats ?? [];
  return 1 + seats.filter((other) => result.scores[other] < result.scores[seat]).length;
}
