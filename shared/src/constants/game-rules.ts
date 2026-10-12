// ─── Game rule constants ───

import type { GameSeat, Seat, BidSuit, Team, GameType } from '../types';

/** All game types */
export const GAME_TYPES: readonly GameType[] = ['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'chinesepoker', 'liarsdeck', 'blackjack', 'holdem'];

/** Games that start with two to eight occupied seats; every other game needs all four */
export const FLEXIBLE_SEAT_GAMES: readonly GameType[] = ['ninetynine', 'blackjack', 'holdem'];

/** Fewest occupied seats a flexible-seat match starts with */
export const MIN_FLEXIBLE_PLAYERS = 2;

/** Unseated human members a room accepts besides its four seats */
export const MAX_SPECTATORS = 8;

/** Room members at most: eight seats (human or bot) plus spectators */
export const MAX_ROOM_MEMBERS = 8 + MAX_SPECTATORS;

/** Maximum configured waiting-room seats, including the four standard seats. */
export const MAX_ROOM_SEATS = 8;

/** Modes with additional waiting-room seats; matches currently still require four seats. */
export const EXPANDABLE_ROOM_GAMES: readonly GameType[] = ['ninetynine', 'blackjack', 'holdem'];

/** Abort vote: passes once this many yes votes are cast */
export const ABORT_VOTE_THRESHOLD = 3;

/** Abort vote: voting window (ms) */
export const ABORT_VOTE_DURATION_MS = 60_000;

/** Abort vote: cooldown measured from initiation (ms) */
export const ABORT_VOTE_COOLDOWN_MS = 180_000;

/** Cards dealt to each player */
export const HAND_SIZE = 13;

/** Tricks per deal */
export const TOTAL_TRICKS = 13;

/** Book: tricks added to the contract level */
export const CONTRACT_BASE_TRICKS = 6;

/** Seat order, clockwise */
export const SEAT_ORDER_CLOCKWISE: readonly Seat[] = ['N', 'E', 'S', 'W'];
export const GAME_SEAT_ORDER: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5', 'P6', 'P7', 'P8'];

/** Team assignment */
export const TEAM_SEATS: Record<Team, readonly [Seat, Seat]> = {
  EW: ['E', 'W'],
  NS: ['N', 'S'],
};

/** Bid suit ranking (low to high) */
export const BID_SUIT_ORDER: readonly BidSuit[] = ['clubs', 'diamonds', 'hearts', 'spades', 'nt'];

/** Redeal condition: no ace and total HCP at or below this value */
export const REDEAL_MAX_POINTS = 4;

/** Reconnect timeout after disconnect (ms) */
export const RECONNECT_TIMEOUT_MS = 60_000;

/** Room code length */
export const ROOM_CODE_LENGTH = 6;

/** Maximum nickname length */
export const NICKNAME_MAX_LENGTH = 20;
