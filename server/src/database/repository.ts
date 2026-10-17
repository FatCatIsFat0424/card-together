import type { AccountProfile, AvatarBorderId, DailyRewardId, DailyRewardsStatus, DailyTaskId, EmojiRecord, MatchResult, MediaId, MessageContent, ShopItemId } from '@shared/types';
import type { DailyRewardsRecord } from './daily-rewards';
import type { AchievementsRecord } from './achievements';
import type { AchievementsStatus } from '@shared/types';
import type { AchievementCategoryId } from '@shared/constants/achievements';

export type { EmojiRecord };
import type { RuntimeSnapshot } from '../runtime/types';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface AccountRecord extends AccountProfile {
  /** Historical activity survives ephemeral player cleanup; omitted for unknown history. */
  readonly lastSeenAt?: number;
  readonly dailyRewards?: DailyRewardsRecord;
  readonly achievements?: AchievementsRecord;
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

export { SOCIAL_HISTORY_RETENTION_MS } from '@shared/constants';

export interface DirectMessageRecord extends MessageContent {
  readonly id: string;
  readonly clientId: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly timestamp: number;
}

export interface MessageReadRecord {
  readonly accountId: string;
  readonly otherId: string;
  readonly messageId: string;
}

export interface FriendNotificationRecord {
  readonly id: string;
  readonly accountId: string;
  readonly actorId: string;
  readonly createdAt: number;
}

/** All writes resolve after durable storage. SQL adapters must preserve atomic checks. */
export interface Repository {
  getAccountById(id: string): Promise<AccountRecord | null>;
  getAccountByUsername(usernameNormalized: string): Promise<AccountRecord | null>;
  searchAccounts(query: string, excludeId: string, limit?: number): Promise<AccountProfile[]>;
  createAccount(account: AccountRecord): Promise<AccountRecord>;
  /** Apply only supplied editable fields, preserving other committed profile changes. */
  updateProfile(
    id: string,
    profile: Partial<Pick<
      AccountProfile,
      | 'nickname' | 'color' | 'avatar' | 'avatarImage' | 'seatBackground' | 'tableBackground'
      | 'tableBackgroundOpacity' | 'cardBack' | 'cardBackOpacity' | 'matchesPublic'
      | 'avatarBorder' | 'cardBackStyle' | 'tableBackgroundStyle' | 'seatBackgroundStyle' | 'nameplate'
      | 'cardFaceStyle' | 'soundPack' | 'chipStyle' | 'seatFrame' | 'victoryEffect' | 'chatFrame'
    >>,
    now: number,
  ): Promise<AccountRecord | null>;
  /** Atomically debit the catalog price and grant ownership; repeats do not debit again. */
  purchaseAvatarBorder(id: string, border: AvatarBorderId, now: number): Promise<AccountRecord | null>;
  /** Atomically debit the catalog price and grant permanent ownership, once per item. */
  purchaseShopItem(id: string, item: ShopItemId, now: number): Promise<AccountRecord | null>;
  getDailyRewards(id: string): Promise<DailyRewardsStatus | null>;
  getAchievements(id: string): Promise<AchievementsStatus | null>;
  /** Validate every item and grant the exclusive title once, in a single durable write. */
  claimAchievement(id: string, category: AchievementCategoryId): Promise<{
    account: AccountRecord; achievements: AchievementsStatus;
  } | null>;
  /** Once per server day; retrying the same replacement returns the saved assignment. */
  replaceDailyTask(id: string, task: DailyTaskId, day: string): Promise<{
    account: AccountRecord; dailyRewards: DailyRewardsStatus;
  } | null>;
  /** Validate server date/eligibility and credit once, atomically with the receipt. */
  claimDailyReward(id: string, reward: DailyRewardId, day: string): Promise<{
    account: AccountRecord; dailyRewards: DailyRewardsStatus;
  } | null>;
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
  /** Participant-only chronological history, excluding messages at least 90 days old. */
  listDirectMessages(accountId: string, otherId?: string): Promise<DirectMessageRecord[]>;
  /** Check friendship and deduplicate sender/clientId atomically; conflicting retries fail. */
  createDirectMessage(message: DirectMessageRecord): Promise<DirectMessageRecord>;
  listMessageReads(accountId: string): Promise<MessageReadRecord[]>;
  /** A retained message received from this peer advances the cursor; stale updates are ignored. */
  markDirectMessagesRead(accountId: string, otherId: string, messageId: string): Promise<void>;
  listFriendNotifications(accountId: string): Promise<FriendNotificationRecord[]>;
  dismissFriendNotifications(accountId: string, ids: readonly string[]): Promise<void>;
  /** Durably remove expired messages, notifications, and their orphaned read cursors. */
  pruneSocialHistory(now: number): Promise<void>;
  loadRuntime(): Promise<RuntimeSnapshot | null>;
  /**
   * Atomically commit runtime/history, once-per-game rewards, and monotonic account last-seen
   * times: commit time for connected players, observed disconnect time for offline players.
   * Restore-only reconnection grace periods do not imply activity.
   * Missing players retain their historical last-seen times.
   */
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
    ownedShopItems: account.ownedShopItems ?? [],
    ownedAchievementNameplates: account.ownedAchievementNameplates ?? [],
    cardBackStyle: account.cardBackStyle ?? null,
    tableBackgroundStyle: account.tableBackgroundStyle ?? null,
    seatBackgroundStyle: account.seatBackgroundStyle ?? null,
    nameplate: account.nameplate ?? null,
    cardFaceStyle: account.cardFaceStyle ?? null,
    soundPack: account.soundPack ?? null,
    chipStyle: account.chipStyle ?? null,
    seatFrame: account.seatFrame ?? null,
    victoryEffect: account.victoryEffect ?? null,
    chatFrame: account.chatFrame ?? null,
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
