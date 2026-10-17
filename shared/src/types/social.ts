import type { AccountProfile } from './account';
import type { MatchSummary } from './game';
import type { RoomCode } from './room';

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

/** An accepted friend with durable activity history and live presence. */
export type FriendEntry = PublicAccount & {
  /** Last committed online time in Unix epoch milliseconds; null for unknown history. */
  readonly lastSeenAt: number | null;
  readonly online: boolean;
  readonly inRoom: boolean;
  /** Online friend's current room when they are its host; null otherwise. */
  readonly hostedRoomCode: RoomCode | null;
};

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
