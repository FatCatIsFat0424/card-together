import type { Card, Seat } from '../types';
import type { HeartsHandScore, HeartsPass, HeartsTrick, HeartsTrickRecord } from '../games/hearts/types';
import { hasCard, cardKey } from './cards';

export const HEARTS_SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
export const HEARTS_TARGET = 100;
// Every hand adds at least 26 total points; 16 hands exceed four scores below 100.
export const HEARTS_MAX_HANDS = 16;
export const emptyHeartsScores = (): Record<Seat, number> => ({ N: 0, E: 0, S: 0, W: 0 });
export function heartsPassDirection(hand: number): HeartsPass {
  return (['left', 'right', 'across', 'hold'] as const)[(hand - 1) % 4];
}
export function nextHeartsSeat(seat: Seat, offset = 1): Seat {
  return HEARTS_SEATS[(HEARTS_SEATS.indexOf(seat) + offset) % 4];
}
export function heartsPassTarget(seat: Seat, direction: HeartsPass): Seat {
  return nextHeartsSeat(seat, direction === 'left' ? 1 : direction === 'right' ? 3 : direction === 'across' ? 2 : 0);
}
export function heartsPenalty(card: Card): number {
  return card.suit === 'hearts' ? 1 : card.suit === 'spades' && card.rank === 12 ? 13 : 0;
}
export function heartsPassError(hand: readonly Card[], cards: readonly Card[]): string | null {
  return cards.length === 3 && new Set(cards.map(cardKey)).size === 3 && cards.every((card) => hasCard(hand, card))
    ? null : 'Choose exactly three different cards from your hand.';
}
export function heartsValidCards(
  hand: readonly Card[], trick: HeartsTrick, firstTrick: boolean, broken: boolean,
): Card[] {
  if (trick.plays.length === 0) {
    if (firstTrick) return hand.filter((card) => card.suit === 'clubs' && card.rank === 2);
    const nonHearts = hand.filter((card) => card.suit !== 'hearts');
    return !broken && nonHearts.length > 0 ? nonHearts : [...hand];
  }
  const following = hand.filter((card) => card.suit === trick.plays[0].card.suit);
  if (following.length > 0) return following;
  const safe = hand.filter((card) => heartsPenalty(card) === 0);
  return firstTrick && safe.length > 0 ? safe : [...hand];
}
export function heartsTrickWinner(trick: HeartsTrick): Seat {
  const first = trick.plays[0];
  if (!first) throw new RangeError('An empty trick has no winner.');
  return trick.plays.reduce((best, play) => play.card.suit === first.card.suit && play.card.rank > best.card.rank
    ? play : best, first).seat;
}
export function scoreHeartsHand(tricks: readonly HeartsTrickRecord[]): HeartsHandScore {
  const penalties = emptyHeartsScores();
  for (const trick of tricks) penalties[trick.winner] += trick.plays.reduce((sum, play) => sum + heartsPenalty(play.card), 0);
  const moon = HEARTS_SEATS.find((seat) => penalties[seat] === 26) ?? null;
  const added = { ...penalties };
  if (moon) for (const seat of HEARTS_SEATS) added[seat] = seat === moon ? 0 : 26;
  return { penalties, added, moon };
}
export function heartsWinners(scores: Readonly<Record<Seat, number>>): Seat[] {
  const low = Math.min(...HEARTS_SEATS.map((seat) => scores[seat]));
  return HEARTS_SEATS.filter((seat) => scores[seat] === low);
}
