import type { AccountProfile, EmojiRecord, MatchResult, MediaId } from '@shared/types';

export type { EmojiRecord };
import type { RuntimeSnapshot } from '../runtime/types';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface AccountRecord extends AccountProfile {
  readonly usernameNormalized: string;
  readonly passwordHash: string;
}

export interface SessionRecord {
  readonly tokenHash: string;
  readonly accountId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface FriendshipRecord {
  readonly id: string;
  readonly requesterId: string;
  readonly recipientId: string;
  readonly status: 'pending' | 'accepted';
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MatchRecord {
  readonly id: string;
  readonly roomCode: string;
  /** Ordered by seat N, E, S, W; includes reserved bot IDs for synthetic participants. */
  readonly accountIds: readonly string[];
  readonly result: MatchResult;
  readonly finishedAt: number;
}

/** All writes resolve after durable storage. SQL adapters must preserve atomic checks. */
export interface Repository {
  getAccountById(id: string): Promise<AccountRecord | null>;
  getAccountByUsername(usernameNormalized: string): Promise<AccountRecord | null>;
  searchAccounts(query: string, excludeId: string, limit?: number): Promise<AccountProfile[]>;
  createAccount(account: AccountRecord): Promise<AccountRecord>;
  updateProfile(
    id: string,
    profile: Pick<
      AccountProfile,
      'nickname' | 'color' | 'avatar' | 'avatarImage' | 'tableBackground' | 'matchesPublic'
    >,
    now: number,
  ): Promise<AccountRecord | null>;
  changePassword(
    id: string,
    expectedHash: string,
    passwordHash: string,
    now: number,
  ): Promise<boolean>;
  createSession(session: SessionRecord, expectedPasswordHash: string): Promise<boolean>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteAccountSessions(accountId: string): Promise<void>;
  listFriendships(accountId: string): Promise<FriendshipRecord[]>;
  getFriendship(id: string): Promise<FriendshipRecord | null>;
  createFriendship(friendship: FriendshipRecord): Promise<FriendshipRecord>;
  acceptFriendship(id: string, recipientId: string): Promise<FriendshipRecord | null>;
  deleteFriendship(
    id: string,
    accountId: string,
    expectedStatus?: FriendshipRecord['status'],
  ): Promise<boolean>;
  loadRuntime(): Promise<RuntimeSnapshot | null>;
  saveRuntime(snapshot: RuntimeSnapshot, matches?: readonly MatchRecord[]): Promise<void>;
  saveMatch(match: MatchRecord): Promise<void>;
  listMatches(accountId: string, limit?: number): Promise<MatchRecord[]>;
  listEmojis(accountId: string): Promise<EmojiRecord[]>;
  /** All-or-nothing: EMOJI_EXISTS on a duplicate name, EMOJI_LIMIT past the per-account cap. */
  createEmojis(
    accountId: string,
    items: readonly { name: string; mediaId: MediaId }[],
    now: number,
  ): Promise<EmojiRecord[]>;
  deleteEmoji(accountId: string, id: string): Promise<boolean>;
  /** Null when the emoji is not this account's; EMOJI_EXISTS when the name is taken. */
  renameEmoji(accountId: string, id: string, name: string): Promise<EmojiRecord | null>;
  close(): Promise<void>;
}

export function publicAccount(account: AccountRecord): AccountProfile {
  return {
    id: account.id,
    username: account.username,
    nickname: account.nickname,
    color: account.color,
    avatar: account.avatar,
    avatarImage: account.avatarImage,
    tableBackground: account.tableBackground,
    matchesPublic: account.matchesPublic,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function repositoryError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
