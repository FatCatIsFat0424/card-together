import type { AccountProfile } from './account';
import type { MatchSummary } from './game';
import type { GameType, RoomCode, RoomStatus } from './room';

/** Account details visible to other signed-in players. */
export type PublicAccount = Pick<
  AccountProfile,
  'id' | 'username' | 'nickname' | 'color' | 'avatar' | 'avatarImage' | 'avatarBorder' | 'nameplate' | 'chatFrame'
>;

/** `GET /api/players/:id/history`; `players` resolves every match participant still on record. */
export interface MatchHistory {
  readonly matches: MatchSummary[];
  readonly players: Record<string, PublicAccount>;
}

export interface FriendRequest {
  readonly id: string;
  readonly requester: PublicAccount;
  readonly recipient: PublicAccount;
  readonly createdAt: number;
}

/** The room an online friend is in, as their friends see it. */
export interface FriendRoomPresence {
  readonly code: RoomCode;
  readonly gameType: GameType;
  readonly status: RoomStatus;
  /** Occupied seats (people and bots) out of every seat the room has. */
  readonly players: number;
  readonly seats: number;
  /** Whether the friend hosts the room. */
  readonly hosting: boolean;
  /** `room:joinFriend` admits the viewer: a waiting room with space for another member. */
  readonly joinable: boolean;
  /** A match or shared replay is running and the spectator area has space. */
  readonly spectatable: boolean;
}

/** An accepted friend with durable activity history and live presence. */
export type FriendEntry = PublicAccount & {
  /** Last committed online time in Unix epoch milliseconds; null for unknown history. */
  readonly lastSeenAt: number | null;
  readonly online: boolean;
  readonly inRoom: boolean;
  /** Online friend's current room when they are its host; null otherwise. */
  readonly hostedRoomCode: RoomCode | null;
  /** Online friend's current room; null while offline or outside a room. */
  readonly room: FriendRoomPresence | null;
};

/** Shared play with one friend, from the viewer's retained match history. */
export interface FriendPlayStats {
  /** Retained matches where the viewer and the friend both took part. */
  readonly together: number;
  /** The friend's most played game in their retained history; null when private or empty. */
  readonly favoriteGame: GameType | null;
}

/** `GET /api/friends/stats`: keyed by friend account ID. */
export type FriendStatsResponse =
  | { readonly success: true; readonly stats: Record<string, FriendPlayStats> }
  | { readonly success: false; readonly error: string };

export interface FriendsData {
  readonly friends: FriendEntry[];
  readonly incoming: FriendRequest[];
  readonly outgoing: FriendRequest[];
}

export type FriendsResponse =
  | ({ readonly success: true } & FriendsData)
  | { readonly success: false; readonly error: string };

export type CreateFriendRequestResponse =
  | { readonly success: true; readonly request: FriendRequest }
  | { readonly success: false; readonly error: string };
