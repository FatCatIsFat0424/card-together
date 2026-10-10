// ─── Game rule constants ───

import type { Seat, BidSuit, Team, GameType } from '../types';

/** All game types */
export const GAME_TYPES: readonly GameType[] = ['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'chinesepoker', 'liarsdeck', 'blackjack', 'holdem'];

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
