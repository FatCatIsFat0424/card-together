import { SEAT_ORDER_CLOCKWISE } from '../constants';
import type { GameSeat, MatchResult } from '../types';
import { gameDefinition } from '../games/registry';

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

/** How `seat` finished `result`, or null when it did not take part. */
export function matchStanding(result: MatchResult, seat: GameSeat): MatchStanding | null {
  const seats = matchSeats(result);
  return seats.includes(seat) ? gameDefinition(result.gameType).result.standing(result, seat, seats) : null;
}
