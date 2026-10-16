import type { GameSeat, GameType, PlayerInfo, RoomInfo, Seat, SeatInfo } from '../types';
import {
  FLEXIBLE_SEAT_GAMES, GAME_SEAT_ORDER, MAX_ROOM_SEATS, MIN_FLEXIBLE_PLAYERS, NAPOLEON_MAX_PLAYERS, NAPOLEON_MIN_PLAYERS,
  SEAT_ORDER_CLOCKWISE,
} from '../constants';

export function nextGameSeat(seat: GameSeat, reverse = false): GameSeat {
  const step = reverse ? -1 : 1;
  return GAME_SEAT_ORDER[(GAME_SEAT_ORDER.indexOf(seat) + step + 8) % 8];
}

/** Games that number every seat in play order (Player 1, Player 2, ...) instead of naming compass seats. */
export function isNumberedSeatGame(gameType: GameType): boolean {
  return gameType === 'napoleon';
}

/** A seat's number in play order, starting at 1. */
export function seatNumber(seat: GameSeat): number {
  return GAME_SEAT_ORDER.indexOf(seat) + 1;
}

/** Bots are named after the seat they sit in: its number in numbered games, otherwise its code. */
export function botNickname(gameType: GameType, seat: GameSeat): string {
  return `Bot ${isNumberedSeatGame(gameType) ? seatNumber(seat) : seat}`;
}

export function isCompassSeat(seat: GameSeat): seat is Seat {
  return (SEAT_ORDER_CLOCKWISE as readonly GameSeat[]).includes(seat);
}

export function gameSeatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

export function roomSeatInfo(room: RoomInfo, seat: GameSeat): SeatInfo | undefined {
  return isCompassSeat(seat) ? room.seats[seat] : room.additionalSeats?.[GAME_SEAT_ORDER.indexOf(seat) - 4];
}

export function roomPlayers(room: RoomInfo): Partial<Record<GameSeat, PlayerInfo>> {
  return Object.fromEntries(GAME_SEAT_ORDER.flatMap((seat) => {
    const player = roomSeatInfo(room, seat)?.player;
    return player ? [[seat, player]] : [];
  }));
}

export function gamePlayer(game: { readonly players: Readonly<Partial<Record<GameSeat, PlayerInfo>>> }, seat: GameSeat): PlayerInfo | undefined {
  return game.players[seat];
}

export function gameSeatValue<T>(values: Readonly<Partial<Record<GameSeat, T>>> | undefined, seat: GameSeat): T | undefined {
  return values?.[seat];
}

export function roomCanStart(room: RoomInfo): boolean {
  const occupied = GAME_SEAT_ORDER.flatMap((seat) => {
    const entry = roomSeatInfo(room, seat);
    return entry?.player ? [entry] : [];
  });
  return room.status === 'waiting' && occupied.length >= minPlayers(room.gameType)
    && occupied.length <= maxPlayers(room.gameType)
    && occupied.some((entry) => !entry.player?.isBot)
    && occupied.every((entry) => entry.isReady);
}

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
  if (gameType === 'napoleon') return NAPOLEON_MIN_PLAYERS;
  return FLEXIBLE_SEAT_GAMES.includes(gameType) ? MIN_FLEXIBLE_PLAYERS : SEAT_ORDER_CLOCKWISE.length;
}

/** Occupied seats a match of this game accepts at most; also caps its waiting-room seats. */
export function maxPlayers(gameType: GameType): number {
  if (gameType === 'napoleon') return NAPOLEON_MAX_PLAYERS;
  return FLEXIBLE_SEAT_GAMES.includes(gameType) ? MAX_ROOM_SEATS : SEAT_ORDER_CLOCKWISE.length;
}

/** Seats with a player, ordered N, E, S, W; empty seats take no part in the match. */
export function occupiedSeats(players: Readonly<Partial<Record<GameSeat, unknown>>>): GameSeat[] {
  return GAME_SEAT_ORDER.filter((seat) => players[seat] !== undefined);
}
