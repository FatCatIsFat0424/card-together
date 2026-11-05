import type { Card } from '../types/game';
import type { Seat } from '../types/player';
import type { SpadesAction, SpadesHandResult, SpadesPlay, SpadesPosition, SpadesTeam, SpadesTeamScore } from '../games/spades/types';

export const SPADES_SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
export const SPADES_TEAMS: readonly SpadesTeam[] = ['NS', 'EW'];
export const SPADES_TARGET = 500;
export function spadesTeam(seat: Seat): SpadesTeam { return seat === 'N' || seat === 'S' ? 'NS' : 'EW'; }
export function spadesNext(seat: Seat): Seat { return SPADES_SEATS[(SPADES_SEATS.indexOf(seat) + 1) % 4]; }
export function spadesSeatMap<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return Object.fromEntries(SPADES_SEATS.map((seat) => [seat, value(seat)])) as Record<Seat, T>;
}
export function newSpadesHand(dealerSeat: Seat): SpadesPosition {
  return { phase: 'bidding', dealerSeat, bids: spadesSeatMap(() => null), taken: spadesSeatMap(() => 0),
    trick: [], tricks: [], broken: false, currentTurnSeat: spadesNext(dealerSeat) };
}
export function sameSpadesCard(a: Card, b: Card): boolean { return a.suit === b.suit && a.rank === b.rank; }
export function spadesLegalCards(hand: readonly Card[], trick: readonly SpadesPlay[], broken: boolean): Card[] {
  if (trick.length > 0) {
    const following = hand.filter((card) => card.suit === trick[0].card.suit);
    return following.length > 0 ? following : [...hand];
  }
  const nontrumps = hand.filter((card) => card.suit !== 'spades');
  return !broken && nontrumps.length > 0 ? nontrumps : [...hand];
}
export function spadesTrickWinner(plays: readonly SpadesPlay[]): Seat {
  if (plays.length === 0) throw new Error('A trick needs a lead.');
  const lead = plays[0].card.suit;
  const strength = (card: Card): number => (card.suit === 'spades' ? 100 : card.suit === lead ? 50 : 0) + card.rank;
  return plays.reduce((best, play) => strength(play.card) > strength(best.card) ? play : best).seat;
}
/** Returns a new position; the caller removes a legally played card from its private hand. */
export function applySpadesMove(position: SpadesPosition, seat: Seat, hand: readonly Card[], action: SpadesAction): SpadesPosition | null {
  if (position.currentTurnSeat !== seat) return null;
  if (action.type === 'bid') {
    if (position.phase !== 'bidding' || position.bids[seat] !== null || !Number.isInteger(action.bid)
      || action.bid < 0 || action.bid > 13) return null;
    const bids = { ...position.bids, [seat]: action.bid };
    const complete = SPADES_SEATS.every((other) => bids[other] !== null);
    return { ...position, bids, phase: complete ? 'playing' : 'bidding', currentTurnSeat: spadesNext(seat) };
  }
  if (position.phase !== 'playing' || !spadesLegalCards(hand, position.trick, position.broken)
    .some((card) => sameSpadesCard(card, action.card))) return null;
  const trick = [...position.trick, { seat, card: action.card }];
  const broken = position.broken || action.card.suit === 'spades';
  if (trick.length < 4) return { ...position, trick, broken, currentTurnSeat: spadesNext(seat) };
  const winner = spadesTrickWinner(trick);
  const tricks = [...position.tricks, { plays: trick, winner }];
  return { ...position, broken, trick: [], tricks, taken: { ...position.taken, [winner]: position.taken[winner] + 1 },
    phase: tricks.length === 13 ? 'complete' : 'playing', currentTurnSeat: tricks.length === 13 ? null : winner };
}
/** Failed nil tricks never fulfill a nonnil contract, but each is a one-point bag. */
export function scoreSpadesHand(bids: Readonly<Record<Seat, number>>, taken: Readonly<Record<Seat, number>>,
  previousBags: Readonly<Record<SpadesTeam, number>>): SpadesHandResult {
  const teamScore = (team: SpadesTeam): SpadesTeamScore => {
    const members = SPADES_SEATS.filter((seat) => spadesTeam(seat) === team);
    const contract = members.reduce((sum, seat) => sum + bids[seat], 0);
    const tricks = members.reduce((sum, seat) => sum + (bids[seat] === 0 ? 0 : taken[seat]), 0);
    const nilTricks = members.reduce((sum, seat) => sum + (bids[seat] === 0 ? taken[seat] : 0), 0);
    const nilPoints = members.reduce((sum, seat) => sum + (bids[seat] === 0 ? taken[seat] === 0 ? 100 : -100 : 0), 0);
    const bagsAdded = Math.max(0, tricks - contract) + nilTricks;
    const contractPoints = tricks >= contract ? contract * 10 : -contract * 10;
    const allBags = previousBags[team] + bagsAdded;
    const bagPenalty = Math.floor(allBags / 10) * 100;
    return { contract, tricks, nilPoints, contractPoints, bagsAdded, bagPenalty,
      points: contractPoints + nilPoints + bagsAdded - bagPenalty, bags: allBags % 10 };
  };
  return { bids: { ...bids }, taken: { ...taken }, teams: { NS: teamScore('NS'), EW: teamScore('EW') } };
}
export function spadesWinners(scores: Readonly<Record<SpadesTeam, number>>): Seat[] {
  if (Math.max(scores.NS, scores.EW) < SPADES_TARGET || scores.NS === scores.EW) return [];
  const winner = scores.NS > scores.EW ? 'NS' : 'EW';
  return SPADES_SEATS.filter((seat) => spadesTeam(seat) === winner);
}
