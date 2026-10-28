import type { Seat, GameSeat, Card } from '@shared/types';
import { GAME_SEAT_ORDER, MIN_FLEXIBLE_PLAYERS } from '@shared/constants';
import { isDeepStrictEqual } from 'node:util';
import { occupiedSeats } from '@shared/rules/seats';

export type ObjectValue = Record<string, unknown>;
export type PlayerValidator = (value: unknown) => boolean;

export const seats: Seat[] = ['N', 'E', 'S', 'W'];

export const gameSeats: GameSeat[] = [...GAME_SEAT_ORDER];

export const suits = ['clubs', 'diamonds', 'hearts', 'spades'];

export function object(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function oneOf(value: unknown, choices: string[]): boolean {
  return typeof value === 'string' && choices.includes(value);
}

export function card(value: unknown): boolean {
  return (
    object(value) &&
    oneOf(value.suit, suits) &&
    number(value.rank) &&
    Number.isInteger(value.rank) &&
    value.rank >= 2 &&
    value.rank <= 14
  );
}

export function cards(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every(card);
}

export function seatCounts(value: unknown, max: number): value is Record<Seat, number> {
  return object(value) && Object.keys(value).length === 4 &&
    seats.every((seat) => number(value[seat]) && value[seat] <= max);
}

export function seatCards(value: unknown, max: number): boolean {
  return object(value) && Object.keys(value).length === 4 && seats.every((seat) => cards(value[seat], max));
}

/** Compares as persisted JSON, so in-memory signed zeros or undefined keys do not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
}

export function commonGame(value: ObjectValue, player: PlayerValidator): boolean {
  return text(value.id) && text(value.roomCode) && number(value.startedAt) && object(value.players) &&
    Object.keys(value.players).length === 4 && seats.every((seat) => player((value.players as ObjectValue)[seat]));
}

/** Blackjack and Hold'em: two to four seats hold players and empty seats are absent. */
export function flexibleSeatGame(value: ObjectValue, player: PlayerValidator): boolean {
  if (!text(value.id) || !text(value.roomCode) || !number(value.startedAt) || !object(value.players)) return false;
  const players = value.players;
  const keys = Object.keys(players);
  return keys.length >= MIN_FLEXIBLE_PLAYERS && keys.length <= 8 && keys.every((key) => oneOf(key, gameSeats) && player(players[key]));
}

/** Seats a flexible-seat result lists in N, E, S, W order; legacy results omit them and had all four. */
export function resultSeats(value: ObjectValue): GameSeat[] | null {
  if (value.seats === undefined) return seats;
  const listed = value.seats;
  return gameSeatList(listed) && listed.length >= MIN_FLEXIBLE_PLAYERS
    && sameJson(listed, gameSeats.filter((seat) => listed.includes(seat))) ? listed : null;
}

/** The result a finished flexible-seat match must hold; legacy four-seat results did not list seats. */
export function flexibleResult<T extends object>(stored: unknown, participants: GameSeat[], expected: T): T & { seats?: GameSeat[] } {
  return participants.length === seats.length && object(stored) && stored.seats === undefined
    ? expected : { ...expected, seats: participants };
}

/** Distinct accounts hold the seats taking part. */
export function distinctPlayers(players: Readonly<Partial<Record<GameSeat, { readonly id: string }>>>): boolean {
  const participants = occupiedSeats(players);
  return new Set(participants.map((seat) => players[seat]?.id)).size === participants.length;
}

export function gameSeatValues(value: unknown, valid: (entry: unknown) => boolean): value is Record<GameSeat, unknown> {
  return object(value) && Object.keys(value).length === 8 && gameSeats.every((seat) => valid(value[seat]));
}

export function gameSeatCounts(value: unknown, max: number): value is Record<GameSeat, number> {
  return gameSeatValues(value, (entry) => number(entry) && entry <= max);
}

export function chipCounts(value: unknown): value is Record<GameSeat, number> {
  return gameSeatCounts(value, Number.MAX_SAFE_INTEGER);
}

export function gameSeatList(value: unknown): value is GameSeat[] {
  return Array.isArray(value) && value.every((seat: unknown) => oneOf(seat, gameSeats)) && new Set(value).size === value.length;
}

export const cardId = (entry: Card): string => `${entry.suit}-${entry.rank}`;
