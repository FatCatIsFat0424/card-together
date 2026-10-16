// ─── Room types ───

import type { PlayerInfo, Seat } from './player';

/** Room code (6 alphanumeric characters) */
export type RoomCode = string;

/** Game type */
export type GameType = 'bridge' | 'bigtwo' | 'redpoints' | 'ninetynine' | 'sevens' | 'chinesepoker' | 'liarsdeck' | 'blackjack' | 'holdem' | 'napoleon';

/** Room status */
export type RoomStatus = 'waiting' | 'playing';

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

/** Presentation shown when Dragon Slaying closes a row: a dragon cut down along it, or the fire alone. */
export type SevensSlayEffect = 'dragon' | 'fire';

export interface SevensOptions {
  readonly closeOnEnd: boolean;
  /** Missing means the dragon */
  readonly slayEffect?: SevensSlayEffect;
}

export interface NinetyNineOptions {
  readonly twoDecks: boolean;
}

export interface BlackjackOptions {
  /** Seats take turns as the dealer instead of the house */
  readonly playerDealer: boolean;
}

export interface NapoleonOptions {
  /** The led trump 2 and 3 may summon the big and small joker */
  readonly jokerSummon: boolean;
}

/** Room info (public) */
export interface RoomInfo {
  /** Randomize occupied seats when the host starts; missing defaults to false. */
  readonly shuffleSeats?: boolean;
  /** Missing on legacy snapshots; defaults to standard Sevens rules. */
  readonly sevensOptions?: SevensOptions;
  /** Missing on legacy snapshots; defaults to the house dealer. */
  readonly blackjackOptions?: BlackjackOptions;
  /** Missing on legacy snapshots; defaults to joker summoning on. */
  readonly napoleonOptions?: NapoleonOptions;
  /** Missing only on legacy snapshots. */
  readonly timeControl?: TimeControl;
  /** Missing on legacy snapshots; defaults to standard Ninety-Nine rules. */
  readonly ninetyNineOptions?: NinetyNineOptions;
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
  /** Unseated human members in join order; added to snapshots only. */
  readonly spectators?: readonly PlayerInfo[];
  /**
   * Accounts with god view during a match (spectators and eliminated seats); added to
   * snapshots only, and empty outside a match.
   */
  readonly observerIds?: readonly string[];
}
