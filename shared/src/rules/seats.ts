import type { GameType, Seat } from '../types';
import { FLEXIBLE_SEAT_GAMES, MIN_FLEXIBLE_PLAYERS, SEAT_ORDER_CLOCKWISE } from '../constants';

/** N → E → S → W → N. */
export function nextSeatClockwise(seat: Seat): Seat {
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + 1) % SEAT_ORDER_CLOCKWISE.length];
}

/** N → W → S → E → N. */
export function nextSeatCounterClockwise(seat: Seat): Seat {
  const index = SEAT_ORDER_CLOCKWISE.indexOf(seat);
  return SEAT_ORDER_CLOCKWISE[(index + SEAT_ORDER_CLOCKWISE.length - 1) % SEAT_ORDER_CLOCKWISE.length];
}

/** Occupied seats a match of this game needs before it can start. */
export function minPlayers(gameType: GameType): number {
  return FLEXIBLE_SEAT_GAMES.includes(gameType) ? MIN_FLEXIBLE_PLAYERS : SEAT_ORDER_CLOCKWISE.length;
}

/** Seats with a player, ordered N, E, S, W; empty seats take no part in the match. */
export function occupiedSeats(players: Readonly<Partial<Record<Seat, unknown>>>): Seat[] {
  return SEAT_ORDER_CLOCKWISE.filter((seat) => players[seat] !== undefined);
}
