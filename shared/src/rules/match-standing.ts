import { SEAT_ORDER_CLOCKWISE } from '../constants';
import type { GameSeat, MatchResult, Seat } from '../types';
import { BJ_STARTING_CHIPS } from './blackjack';
import { HE_STARTING_CHIPS } from './holdem';
import { nnRank } from './ninetynine';

/** The declaring side (Bridge declarer partnership, Napoleon and secretary) against the defence. */
export type StandingSide = 'declarer' | 'defender';

export type StandingRole = 'declarer' | 'partner' | 'napoleon' | 'secretary' | 'defender';

/** How one seat finished a match; the single outcome rule for history, achievements and daily tasks. */
export interface MatchStanding {
  readonly seat: GameSeat;
  /** Seats that took part, which sets the chance level of a ranking game */
  readonly players: number;
  /** 1 is first; seats on equal footing share the better rank. Null in side games, which have no ranking. */
  readonly rank: number | null;
  /** Another seat holds the same rank */
  readonly tied: boolean;
  /** First place, ties included, or the winning side */
  readonly won: boolean;
  /** Null in ranking games */
  readonly side: StandingSide | null;
  /** Null in ranking games */
  readonly role: StandingRole | null;
  /**
   * The seat's figure in the game's own unit: penalty (Big Two, Sevens), points (Red Points, Chinese Poker)
   * or chips against the starting stack (Blackjack, Hold'em). Null where the game has none.
   */
  readonly score: number | null;
}

const COMPASS: readonly GameSeat[] = SEAT_ORDER_CLOCKWISE;

/** Seats that took part; results without a `seats` list were always played by N, E, S, W. */
export function matchSeats(result: MatchResult): readonly GameSeat[] {
  return 'seats' in result && result.seats ? result.seats : COMPASS;
}

/** Games without a `seats` list only ever use compass seats. */
function compass(values: Readonly<Record<Seat, number>>, seat: GameSeat): number {
  return values[seat as Seat];
}

/** Competition ranking: winners share first, then each seat ranks by how many others are strictly ahead of it. */
function rankAfterWinners(
  seats: readonly GameSeat[], winners: readonly GameSeat[], seat: GameSeat,
  value: (seat: GameSeat) => number, lowerIsBetter: boolean,
): number {
  if (winners.includes(seat)) return 1;
  const ahead = seats.filter((other) => !winners.includes(other)
    && (lowerIsBetter ? value(other) < value(seat) : value(other) > value(seat))).length;
  return winners.length + 1 + ahead;
}

interface RankedFinish {
  readonly rank: number;
  readonly score: number | null;
}

function rankedFinish(
  result: Exclude<MatchResult, { readonly gameType: 'bridge' | 'napoleon' }>, seat: GameSeat, seats: readonly GameSeat[],
): RankedFinish {
  switch (result.gameType) {
    case 'bigtwo':
      return { rank: rankAfterWinners(seats, [result.winnerSeat], seat, (other) => compass(result.scores, other), true),
        score: compass(result.scores, seat) };
    case 'redpoints':
      return { rank: rankAfterWinners(seats, result.winners, seat, (other) => compass(result.points, other), false),
        score: compass(result.points, seat) };
    case 'sevens':
      return { rank: rankAfterWinners(seats, result.winners, seat, (other) => compass(result.penalties, other), true),
        score: compass(result.penalties, seat) };
    case 'chinesepoker':
      return { rank: rankAfterWinners(seats, result.winners, seat, (other) => compass(result.scores, other), false),
        score: compass(result.scores, seat) };
    case 'ninetynine':
      return { rank: nnRank(result, seat), score: null };
    case 'liarsdeck': {
      const eliminated: readonly GameSeat[] = result.eliminationOrder;
      return { rank: seat === result.winnerSeat ? 1 : seats.length - eliminated.indexOf(seat), score: null };
    }
    case 'blackjack':
      return { rank: rankAfterWinners(seats, result.winners, seat, (other) => result.chips[other], false),
        score: result.chips[seat] - BJ_STARTING_CHIPS };
    case 'holdem': {
      // Seats that lost every chip rank by when they went out; the rest by their chips.
      const out = result.eliminationOrder.indexOf(seat);
      const survivors = seats.filter((other) => !result.eliminationOrder.includes(other));
      const rank = out >= 0 ? seats.length - out
        : rankAfterWinners(survivors, result.winners, seat, (other) => result.chips[other], false);
      return { rank, score: result.chips[seat] - HE_STARTING_CHIPS };
    }
  }
}

function onSide(seat: GameSeat, declarer: GameSeat): boolean {
  return COMPASS.indexOf(seat) % 2 === COMPASS.indexOf(declarer) % 2;
}

/** How `seat` finished `result`, or null when it did not take part. */
export function matchStanding(result: MatchResult, seat: GameSeat): MatchStanding | null {
  const seats = matchSeats(result);
  if (!seats.includes(seat)) return null;
  if (result.gameType === 'bridge') {
    const declaring = onSide(seat, result.contract.declarer);
    return { seat, players: seats.length, rank: null, tied: false, won: declaring === result.declarerTeamWins,
      side: declaring ? 'declarer' : 'defender', score: null,
      role: seat === result.contract.declarer ? 'declarer' : declaring ? 'partner' : 'defender' };
  }
  if (result.gameType === 'napoleon') {
    const role: StandingRole = seat === result.contract.napoleon ? 'napoleon'
      : seat === result.secretarySeat ? 'secretary' : 'defender';
    return { seat, players: seats.length, rank: null, tied: false, won: result.winners.includes(seat),
      side: role === 'defender' ? 'defender' : 'declarer', role, score: null };
  }
  const { rank, score } = rankedFinish(result, seat, seats);
  const tied = seats.some((other) => other !== seat && rankedFinish(result, other, seats).rank === rank);
  return { seat, players: seats.length, rank, tied, won: rank === 1, side: null, role: null, score };
}
