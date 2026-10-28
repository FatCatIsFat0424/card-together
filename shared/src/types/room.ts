// ─── Room types ───

import type { PlayerInfo, Seat } from './player';
import type { GameOptionsByType, GameType } from '../games/type-registry';

export type { GameOptionsByType, GameType } from '../games/type-registry';
export type { SevensOptions, SevensSlayEffect } from '../games/sevens/types';
export type { NinetyNineOptions } from '../games/ninetynine/types';
export type { BlackjackOptions } from '../games/blackjack/types';
export type { NapoleonOptions } from '../games/napoleon/types';

/** Room code (6 alphanumeric characters) */
export type RoomCode = string;

/** Room status; a shared replay locks the room like a match until the host ends it. */
export type RoomStatus = 'waiting' | 'playing' | 'replaying';

/** Seat info */
export interface SeatInfo {
  readonly player: PlayerInfo | null;
  readonly isReady: boolean;
}

/** Seat map: state of the four seats */
export type SeatMap = Record<Seat, SeatInfo>;

/** Destination for a host moving a human member in a waiting room. */
export type RoomSeatTarget =
  | { readonly type: 'seat'; readonly seat: Seat }
  | { readonly type: 'additional'; readonly index: number }
  | { readonly type: 'spectator' };

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

export type GameOptions = Partial<GameOptionsByType>;

/** The game discriminator keeps rules from one game out of another game's payload. */
export type GameOptionsPayload = {
  [K in GameType]: { readonly gameType: K; readonly options: GameOptionsByType[K] };
}[GameType];

/** Host-controlled playback of a recorded match that every room member watches. */
export interface RoomReplaySession {
  readonly matchId: string;
  /** Account whose match history the host shared it from; its permission is checked at start. */
  readonly subjectId: string;
  readonly gameType: GameType;
  /** Host who started the session; control follows the current host. */
  readonly startedBy: string;
  /** Index of the final step; step 0 is the initial snapshot. */
  readonly lastStep: number;
  /** Step shown at `anchorAt` (server time); playback advances from there while `playing`. */
  readonly anchorStep: number;
  readonly anchorAt: number;
  readonly playing: boolean;
  /** Playback rate between `REPLAY_SPEED_MIN` and `REPLAY_SPEED_MAX`. */
  readonly speed: number;
}

/** Room info (public) */
export interface RoomInfo {
  /** Randomize occupied seats when the host starts; missing defaults to false. */
  readonly shuffleSeats?: boolean;
  /** Per-game choices survive game switches; missing on legacy runtime snapshots. */
  readonly gameOptions?: GameOptions;
  /** Missing only on legacy snapshots. */
  readonly timeControl?: TimeControl;
  readonly code: RoomCode;
  readonly gameType: GameType;
  readonly status: RoomStatus;
  readonly seats: SeatMap;
  /** Additional waiting-room seats, numbered from 5; omitted by older snapshots. */
  readonly additionalSeats?: readonly SeatInfo[];
  readonly createdAt: number;
  /** Host: the creator; passes to the next member in join order when they leave */
  readonly hostId: string;
  readonly abortVote: AbortVoteInfo | null;
  readonly abortVoteCooldownUntil: number | null;
  /** Present exactly while the status is `replaying`. */
  readonly replay?: RoomReplaySession;
  /** Unseated human members in join order; added to snapshots only. */
  readonly spectators?: readonly PlayerInfo[];
  /**
   * Accounts with god view during a match (spectators and eliminated seats); added to
   * snapshots only, and empty outside a match.
   */
  readonly observerIds?: readonly string[];
}
