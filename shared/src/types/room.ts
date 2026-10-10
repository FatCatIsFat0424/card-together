// ─── Room types ───

import type { PlayerInfo, Seat } from './player';

/** Room code (6 alphanumeric characters) */
export type RoomCode = string;

/** Game type */
export type GameType = 'bridge' | 'bigtwo' | 'redpoints' | 'ninetynine' | 'sevens' | 'chinesepoker' | 'liarsdeck' | 'blackjack';

/** Room status */
export type RoomStatus = 'waiting' | 'playing';

/** Seat info */
export interface SeatInfo {
  readonly player: PlayerInfo | null;
  readonly isReady: boolean;
}

/** Seat map: state of the four seats */
export type SeatMap = Record<Seat, SeatInfo>;

/** Active abort-game vote (account ids) */
export interface AbortVoteInfo {
  readonly startedBy: string;
  readonly startedAt: number;
  readonly expiresAt: number;
  readonly yes: readonly string[];
  readonly no: readonly string[];
}

export interface TimeControl {
  readonly baseSeconds: number;
  readonly bankSeconds: number;
}

/** Room info (public) */
export interface RoomInfo {
  /** Missing only on legacy snapshots. */
  readonly timeControl?: TimeControl;
  readonly code: RoomCode;
  readonly gameType: GameType;
  readonly status: RoomStatus;
  readonly seats: SeatMap;
  readonly createdAt: number;
  /** Host: the creator; passes to the next member in join order when they leave */
  readonly hostId: string;
  readonly abortVote: AbortVoteInfo | null;
  readonly abortVoteCooldownUntil: number | null;
}
