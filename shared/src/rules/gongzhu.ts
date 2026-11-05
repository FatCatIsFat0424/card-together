import type { Card, Seat } from '../types';
import type { GongZhuPlay } from '../games/gongzhu/types';
import { SEAT_ORDER_CLOCKWISE } from '../constants/game-rules';
import { sameCard } from './cards';

export const GONGZHU_HANDS = 4;
export const GONGZHU_FIRST_CARD: Card = { suit: 'clubs', rank: 2 };

export function gongZhuSeatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return Object.fromEntries(SEAT_ORDER_CLOCKWISE.map((seat) => [seat, value(seat)])) as Record<Seat, T>;
}
export function gongZhuNextSeat(seat: Seat): Seat {
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + 1) % 4];
}
export function gongZhuCardPoints(card: Card): number {
  if (card.suit === 'spades' && card.rank === 12) return -100;
  if (card.suit === 'diamonds' && card.rank === 11) return 100;
  if (card.suit !== 'hearts' || card.rank < 5) return 0;
  return card.rank <= 10 ? -10 : -(card.rank - 9) * 10;
}
export function gongZhuScoringCard(card: Card): boolean {
  return card.suit === 'hearts' || gongZhuCardPoints(card) !== 0 || (card.suit === 'clubs' && card.rank === 10);
}

/** Hearts are evaluated together before the transformer; the grand slam overrides everything. */
export function gongZhuScore(captures: readonly Card[]): number {
  const hearts = captures.filter((card) => card.suit === 'hearts');
  const pig = captures.some((card) => card.suit === 'spades' && card.rank === 12);
  const sheep = captures.some((card) => card.suit === 'diamonds' && card.rank === 11);
  const transformer = captures.some((card) => card.suit === 'clubs' && card.rank === 10);
  const allHearts = hearts.length === 13;
  if (allHearts && pig && sheep && transformer) return 1000;
  const heartScore = allHearts ? 200 : hearts.reduce((sum, card) => sum + gongZhuCardPoints(card), 0);
  const score = heartScore + (pig ? -100 : 0) + (sheep ? 100 : 0);
  if (!transformer) return score;
  const hasOtherValue = pig || sheep || hearts.some((card) => card.rank >= 5);
  return hasOtherValue ? score * 2 : 50;
}

/** Only the opening lead is forced; hearts and penalty cards may otherwise be played at any time. */
export function gongZhuLegalCards(
  hand: readonly Card[], trick: readonly GongZhuPlay[], opening: boolean,
): Card[] {
  if (opening && trick.length === 0) return hand.filter((card) => sameCard(card, GONGZHU_FIRST_CARD));
  const suit = trick[0]?.card.suit;
  const following = hand.filter((card) => card.suit === suit);
  return [...(following.length ? following : hand)];
}
export function gongZhuTrickWinner(plays: readonly GongZhuPlay[]): Seat {
  if (plays.length === 0) throw new Error('A trick must contain a lead.');
  return plays.reduce((best, play) => play.card.suit === best.card.suit && play.card.rank > best.card.rank ? play : best).seat;
}
export function gongZhuWinners(scores: Readonly<Record<Seat, number>>): Seat[] {
  const highest = Math.max(...SEAT_ORDER_CLOCKWISE.map((seat) => scores[seat]));
  return SEAT_ORDER_CLOCKWISE.filter((seat) => scores[seat] === highest);
}
