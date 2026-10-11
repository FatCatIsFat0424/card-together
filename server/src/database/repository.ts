import type { AccountProfile, AvatarBorderId, EmojiRecord, MatchResult, MediaId } from '@shared/types';

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
      | 'nickname' | 'color' | 'avatar' | 'avatarImage' | 'seatBackground' | 'tableBackground'
      | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'matchesPublic'
      | 'avatarBorder'
    >,
    now: number,
  ): Promise<AccountRecord | null>;
  /** Atomically debit the catalog price and grant ownership; repeats do not debit again. */
  purchaseAvatarBorder(id: string, border: AvatarBorderId, now: number): Promise<AccountRecord | null>;
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
  /** Completed game IDs award coins atomically with runtime/history, once per game. */
  saveRuntime(snapshot: RuntimeSnapshot, matches?: readonly MatchRecord[], completedGameIds?: readonly string[]): Promise<void>;
  saveMatch(match: MatchRecord): Promise<void>;
  /** All human-only matches, newest first; an explicit limit requests a bounded subset. */
  listMatches(accountId: string, limit?: number): Promise<MatchRecord[]>;
  listEmojis(accountId: string): Promise<EmojiRecord[]>;
  /** All-or-nothing: EMOJI_EXISTS on a duplicate name, EMOJI_LIMIT past the per-account cap. */
  createEmojis(
    accountId: string,
    items: readonly { name: string; mediaId: MediaId }[],
    now: number,
  ): Promise<EmojiRecord[]>;
  deleteEmoji(accountId: string, id: string): Promise<boolean>;
  /** Deletes this account's entries among `ids` in one write; returns the deleted IDs. */
  deleteEmojis(accountId: string, ids: readonly string[]): Promise<string[]>;
  /** Null when the emoji is not this account's; EMOJI_EXISTS when the name is taken. */
  renameEmoji(accountId: string, id: string, name: string): Promise<EmojiRecord | null>;
  close(): Promise<void>;
}

export function publicAccount(account: AccountRecord): AccountProfile {
  return {
    id: account.id,
    username: account.username,
    coins: account.coins ?? 0,
    coinRevision: account.coinRevision ?? 0,
    ownedAvatarBorders: account.ownedAvatarBorders ?? [],
    avatarBorder: account.avatarBorder ?? null,
    nickname: account.nickname,
    color: account.color,
    avatar: account.avatar,
    avatarImage: account.avatarImage,
    seatBackground: account.seatBackground ?? null,
    tableBackground: account.tableBackground,
    tableBackgroundOpacity: account.tableBackgroundOpacity,
    cardBack: account.cardBack,
    cardBackOpacity: account.cardBackOpacity,
    matchesPublic: account.matchesPublic,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function repositoryError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
