import type { GameSeat, GameType, PlayerInfo, RoomInfo, Seat, SeatInfo } from '../types';
import { GAME_SEAT_ORDER, SEAT_ORDER_CLOCKWISE } from '../constants';
import { gameDefinition } from '../games/registry';

export function nextGameSeat(seat: GameSeat, reverse = false): GameSeat {
  const step = reverse ? -1 : 1;
  return GAME_SEAT_ORDER[(GAME_SEAT_ORDER.indexOf(seat) + step + 8) % 8];
}

/** Games that number every seat in play order (Player 1, Player 2, ...) instead of naming compass seats. */
export function isNumberedSeatGame(gameType: GameType): boolean {
  return gameDefinition(gameType).seats.numbered;
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

/** Bots and the host count as ready without toggling; only other humans must press ready. */
export function isSeatReady(room: Pick<RoomInfo, 'hostId'>, entry: SeatInfo): boolean {
  return entry.isReady || entry.player?.isBot === true || entry.player?.id === room.hostId;
}

export function roomCanStart(room: RoomInfo): boolean {
  const occupied = GAME_SEAT_ORDER.flatMap((seat) => {
    const entry = roomSeatInfo(room, seat);
    return entry?.player ? [entry] : [];
  });
  return room.status === 'waiting' && playerCountAllowed(room.gameType, occupied.length)
    && occupied.some((entry) => !entry.player?.isBot)
    && occupied.every((entry) => isSeatReady(room, entry));
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
  return gameDefinition(gameType).seats.minPlayers;
}

/** Occupied seats a match of this game accepts at most; also caps its waiting-room seats. */
export function maxPlayers(gameType: GameType): number {
  return gameDefinition(gameType).seats.maxPlayers;
}

/** Whether a match of this game can start with `count` occupied seats (Chinese checkers skips five). */
export function playerCountAllowed(gameType: GameType, count: number): boolean {
  const { minPlayers: min, maxPlayers: max, playerCounts } = gameDefinition(gameType).seats;
  return count >= min && count <= max && (playerCounts?.includes(count) ?? true);
}

/**
 * Compass seats a waiting room offers for a game, derived from its player limit: two players face each
 * other (N, S), three take N, E, S, and games for four or more keep all four. Other compass seats stay
 * empty and hidden; the room schema is unchanged.
 */
export function roomCompassSeats(gameType: GameType): readonly Seat[] {
  const limit = maxPlayers(gameType);
  if (limit <= 2) return ['N', 'S'];
  return limit === 3 ? ['N', 'E', 'S'] : SEAT_ORDER_CLOCKWISE;
}

/** Seats with a player, ordered N, E, S, W; empty seats take no part in the match. */
export function occupiedSeats(players: Readonly<Partial<Record<GameSeat, unknown>>>): GameSeat[] {
  return GAME_SEAT_ORDER.filter((seat) => players[seat] !== undefined);
}
