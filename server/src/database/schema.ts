import {
  isBigTwoResult, isBlackjackResult, isChinesePokerResult, isHoldemResult, isLiarsDeckResult, isLiarsDiceResult,
  isNapoleonResult, isNinetyNineResult, isRedPointsResult, isRuntimeSnapshot, isSevensResult, isTenHalfResult, isCrazyEightsResult, isStudResult,
} from '../runtime/validate';
import {
  MAX_EMOJIS_PER_ACCOUNT, MAX_MESSAGE_EMOJIS, NICKNAME_MAX_LENGTH, isEmojiName, isImageOpacity, isMediaId,
  isUsername, isAvatarBorderId, isProvidedEmojiFile, getShopItem, isShopStickerId,
} from '@shared/constants';
import { gameDefinition, isGameType } from '@shared/games/registry';
import type { GameType } from '@shared/types';
import { isReplayRecordId } from '@shared/replay-session';
import type { RuntimeSnapshot } from '../runtime/types';
import type { RuntimeValidationOptions } from '../runtime/validate';
import type {
  AccountRecord, DirectMessageRecord, EmojiRecord, FriendNotificationRecord, FriendshipRecord, MatchRecord, MessageReadRecord, SessionRecord,
} from './repository';
import { equipmentError } from './shop-equipment';
import type { AccountStatsRecord, GameStatsRecord, StatsBackfillState } from './game-stats';
import { accountStatsKey, gameStatsKey, validAccountStats, validGameStats, validStatsBackfill } from './game-stats';
import type { ShopItemId } from '@shared/types';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import { validDailyRewards } from './daily-rewards';
import { validAchievements } from './achievements';
import { isAchievementNameplateId } from '@shared/constants/shop';
import type { AchievementNameplateId } from '@shared/constants/shop';

export interface DatabaseDocument {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  accounts: AccountRecord[];
  sessions: SessionRecord[];
  friendships: FriendshipRecord[];
  matches: MatchRecord[];
  emojis: EmojiRecord[];
  directMessages: DirectMessageRecord[];
  messageReads: MessageReadRecord[];
  friendNotifications: FriendNotificationRecord[];
  /** Per account, game and scope; updated with the completion receipts in `rewardedGameIds`. */
  gameStats: GameStatsRecord[];
  /** Per account and scope: the cross-game streak and recent results. */
  accountStats: AccountStatsRecord[];
  runtime: RuntimeSnapshot | null;
  /** Durable receipts prevent replayed completions from awarding coins twice. */
  rewardedGameIds?: string[];
  /** Present until the schema v9 backfill has counted every stored match. */
  statsBackfill?: StatsBackfillState;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function botId(id: string): boolean {
  return /^bot:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function validAccount(value: unknown): value is AccountRecord {
  return (
    isObject(value) &&
    nonEmpty(value.id) &&
    typeof value.username === 'string' &&
    isUsername(value.username) &&
    (value.coins === undefined || timestamp(value.coins)) &&
    (value.coinRevision === undefined || timestamp(value.coinRevision)) &&
    (value.lastSeenAt === undefined || timestamp(value.lastSeenAt)) &&
    (value.dailyRewards === undefined || validDailyRewards(value.dailyRewards)) &&
    (value.achievements === undefined || validAchievements(value.achievements)) &&
    (value.ownedAchievementNameplates === undefined || (Array.isArray(value.ownedAchievementNameplates)
      && value.ownedAchievementNameplates.every(isAchievementNameplateId)
      && new Set(value.ownedAchievementNameplates).size === value.ownedAchievementNameplates.length)) &&
    (value.ownedAvatarBorders === undefined || (Array.isArray(value.ownedAvatarBorders)
      && value.ownedAvatarBorders.every(isAvatarBorderId)
      && new Set(value.ownedAvatarBorders).size === value.ownedAvatarBorders.length)) &&
    (value.avatarBorder === undefined || value.avatarBorder === null
      || (isAvatarBorderId(value.avatarBorder) && Array.isArray(value.ownedAvatarBorders)
        && value.ownedAvatarBorders.includes(value.avatarBorder))) &&
    (value.ownedShopItems === undefined || (Array.isArray(value.ownedShopItems)
      && value.ownedShopItems.every((id: unknown) => {
        const item = getShopItem(id);
        return item !== undefined && item.type !== 'avatarBorder';
      })
      && new Set(value.ownedShopItems).size === value.ownedShopItems.length)) &&
    equipmentError(value, { ownedShopItems: value.ownedShopItems as readonly ShopItemId[] | undefined,
      ownedAchievementNameplates: value.ownedAchievementNameplates as readonly AchievementNameplateId[] | undefined }) === null &&
    value.usernameNormalized === value.username.toLowerCase() &&
    typeof value.nickname === 'string' &&
    value.nickname.trim().length > 0 &&
    value.nickname.length <= NICKNAME_MAX_LENGTH &&
    typeof value.color === 'string' &&
    /^#[\da-f]{6}$/i.test(value.color) &&
    typeof value.avatar === 'string' &&
    ['cat', 'fox', 'owl', 'bear', 'rabbit', 'panda'].includes(value.avatar) &&
    (value.avatarImage === null || isMediaId(value.avatarImage)) &&
    (value.seatBackground === undefined || value.seatBackground === null || isMediaId(value.seatBackground)) &&
    (value.tableBackground === null || isMediaId(value.tableBackground)) &&
    isImageOpacity(value.tableBackgroundOpacity) &&
    (value.cardBack === null || isMediaId(value.cardBack)) &&
    isImageOpacity(value.cardBackOpacity) &&
    typeof value.matchesPublic === 'boolean' &&
    typeof value.passwordHash === 'string' &&
    /^scrypt\$131072\$8\$1\$[\da-f]{32}\$[\da-f]{128}$/.test(value.passwordHash) &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt)
  );
}

export function validSession(value: unknown): value is SessionRecord {
  return (
    isObject(value) &&
    typeof value.tokenHash === 'string' &&
    /^[\da-f]{64}$/.test(value.tokenHash) &&
    nonEmpty(value.accountId) &&
    timestamp(value.createdAt) &&
    timestamp(value.expiresAt) &&
    value.expiresAt > value.createdAt
  );
}

export function validFriendship(value: unknown): value is FriendshipRecord {
  return (
    isObject(value) &&
    nonEmpty(value.id) &&
    nonEmpty(value.requesterId) &&
    nonEmpty(value.recipientId) &&
    value.requesterId !== value.recipientId &&
    (value.status === 'pending' || value.status === 'accepted') &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt) &&
    (value.recipientReadAt === undefined || timestamp(value.recipientReadAt))
  );
}

export function validMatch(value: unknown): value is MatchRecord {
  if (
    !isObject(value) ||
    !nonEmpty(value.id) ||
    !nonEmpty(value.roomCode) ||
    !timestamp(value.finishedAt) ||
    !Array.isArray(value.accountIds) ||
    !value.accountIds.every(nonEmpty) ||
    new Set(value.accountIds).size !== value.accountIds.length ||
    !isObject(value.result)
  )
    return false;
  // Flexible-seat results list the seats that took part; every other match had four.
  const gameType = value.result.gameType;
  const participants = isGameType(gameType) && gameDefinition(gameType).seats.flexible ? value.result.seats : undefined;
  if (value.accountIds.length !== (Array.isArray(participants) ? participants.length : 4)) return false;
  const validators: Record<GameType, (result: Record<string, unknown>) => boolean> = {
    bridge: validBridgeResult,
    bigtwo: isBigTwoResult,
    redpoints: isRedPointsResult,
    ninetynine: isNinetyNineResult,
    sevens: isSevensResult,
    chinesepoker: isChinesePokerResult,
    liarsdeck: isLiarsDeckResult,
    blackjack: isBlackjackResult,
    holdem: isHoldemResult,
    napoleon: isNapoleonResult,
    tenhalf: isTenHalfResult,
    liarsdice: isLiarsDiceResult,
    crazyeights: isCrazyEightsResult,
    stud: isStudResult,
  };
  // Archives live in the replay store, named by match ID; records carry only the flag.
  return isGameType(gameType) && validators[gameType](value.result) && !Object.hasOwn(value, 'replay') &&
    (value.hasReplay === undefined || (value.hasReplay === true && isReplayRecordId(value.id)));
}

function validBridgeResult(result: Record<string, unknown>): boolean {
  const contract = result.contract;
  return (
    isObject(contract) &&
    Number.isInteger(contract.level) &&
    Number(contract.level) >= 1 &&
    Number(contract.level) <= 7 &&
    ['clubs', 'diamonds', 'hearts', 'spades', 'nt'].includes(String(contract.suit)) &&
    ['N', 'E', 'S', 'W'].includes(String(contract.declarer)) &&
    timestamp(result.declarerTeamTricks) &&
    result.declarerTeamTricks <= 13 &&
    timestamp(result.defenderTeamTricks) &&
    result.defenderTeamTricks <= 13 &&
    result.declarerTeamTricks + result.defenderTeamTricks === 13 &&
    result.requiredTricks === Number(contract.level) + 6 &&
    result.declarerTeamWins === result.declarerTeamTricks >= Number(result.requiredTricks)
  );
}

export function validEmoji(value: unknown): value is EmojiRecord {
  return (
    isObject(value) &&
    nonEmpty(value.id) &&
    nonEmpty(value.accountId) &&
    isEmojiName(value.name) &&
    isMediaId(value.mediaId) &&
    timestamp(value.createdAt)
  );
}

export function validDirectMessage(value: unknown): value is DirectMessageRecord {
  if (!isObject(value) || !nonEmpty(value.id) || !nonEmpty(value.clientId) || value.clientId.length > 128 ||
    !nonEmpty(value.senderId) || !nonEmpty(value.recipientId) || value.senderId === value.recipientId ||
    !timestamp(value.timestamp) || typeof value.content !== 'string' ||
    Object.keys(value).some((key) => ![
      'id', 'clientId', 'senderId', 'recipientId', 'timestamp', 'content',
      'sticker', 'providedSticker', 'shopSticker', 'emojis', 'providedEmojis',
    ].includes(key))) return false;
  if (value.shopSticker !== undefined) {
    return isShopStickerId(value.shopSticker) && value.content === '' && value.sticker === undefined &&
      value.providedSticker === undefined && value.emojis === undefined && value.providedEmojis === undefined;
  }
  const sticker = value.sticker;
  const providedSticker = value.providedSticker;
  if (sticker !== undefined || providedSticker !== undefined) {
    if (value.content !== '' || value.emojis !== undefined || value.providedEmojis !== undefined ||
      (sticker !== undefined && providedSticker !== undefined)) return false;
    return sticker !== undefined
      ? isObject(sticker) && nonEmpty(sticker.id) && isEmojiName(sticker.name) && isMediaId(sticker.mediaId) &&
        Object.keys(sticker).every((key) => ['id', 'name', 'mediaId'].includes(key))
      : isObject(providedSticker) && isEmojiName(providedSticker.name) && isProvidedEmojiFile(providedSticker.file) &&
        Object.keys(providedSticker).every((key) => ['name', 'file'].includes(key));
  }
  if (!value.content.trim() || value.content.length > 500 || value.content !== value.content.trim()) return false;
  if (value.emojis !== undefined && (!isObject(value.emojis) ||
    !Object.entries(value.emojis).every(([name, media]) => isEmojiName(name) && isMediaId(media)))) return false;
  if (value.providedEmojis !== undefined && (!isObject(value.providedEmojis) ||
    !Object.entries(value.providedEmojis).every(([name, file]) => isEmojiName(name) && isProvidedEmojiFile(file)))) return false;
  const personal = isObject(value.emojis) ? Object.keys(value.emojis) : [];
  const provided = isObject(value.providedEmojis) ? Object.keys(value.providedEmojis) : [];
  return personal.length + provided.length <= MAX_MESSAGE_EMOJIS &&
    !provided.some((name) => personal.includes(name));
}

export function validMessageRead(value: unknown): value is MessageReadRecord {
  return isObject(value) && nonEmpty(value.accountId) && nonEmpty(value.otherId) &&
    value.accountId !== value.otherId && nonEmpty(value.messageId);
}

export function validFriendNotification(value: unknown): value is FriendNotificationRecord {
  return isObject(value) && nonEmpty(value.id) && nonEmpty(value.accountId) && nonEmpty(value.actorId) &&
    value.accountId !== value.actorId && timestamp(value.createdAt) &&
    (value.readAt === undefined || timestamp(value.readAt));
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Reject incompatible or corrupt data instead of replacing a user's database. Writes may skip
 * re-applying runtime recording steps, which loading always checks.
 */
export function validateDocument(value: unknown, options: RuntimeValidationOptions = {}): asserts value is DatabaseDocument {
  if (
    !isObject(value) ||
    value.schemaVersion !== CURRENT_SCHEMA_VERSION ||
    !Array.isArray(value.accounts) ||
    !value.accounts.every(validAccount) ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every(validSession) ||
    !Array.isArray(value.friendships) ||
    !value.friendships.every(validFriendship) ||
    !Array.isArray(value.matches) ||
    !value.matches.every(validMatch) ||
    !Array.isArray(value.emojis) ||
    !value.emojis.every(validEmoji) ||
    !Array.isArray(value.directMessages) || !value.directMessages.every(validDirectMessage) ||
    !Array.isArray(value.messageReads) || !value.messageReads.every(validMessageRead) ||
    !Array.isArray(value.friendNotifications) || !value.friendNotifications.every(validFriendNotification) ||
    !Array.isArray(value.gameStats) || !value.gameStats.every(validGameStats) ||
    !Array.isArray(value.accountStats) || !value.accountStats.every(validAccountStats) ||
    (value.statsBackfill !== undefined && !validStatsBackfill(value.statsBackfill)) ||
    (value.rewardedGameIds !== undefined && (!Array.isArray(value.rewardedGameIds)
      || !value.rewardedGameIds.every(nonEmpty) || !unique(value.rewardedGameIds))) ||
    !(value.runtime === null || isRuntimeSnapshot(value.runtime, options))
  ) {
    throw new Error(
      'Invalid or unsupported database schema. Restore a valid backup; the original file was preserved.',
    );
  }
  const accounts = value.accounts as AccountRecord[];
  const sessions = value.sessions as SessionRecord[];
  const friendships = value.friendships as FriendshipRecord[];
  const matches = value.matches as MatchRecord[];
  const emojis = value.emojis as EmojiRecord[];
  const directMessages = value.directMessages as DirectMessageRecord[];
  const messageReads = value.messageReads as MessageReadRecord[];
  const friendNotifications = value.friendNotifications as FriendNotificationRecord[];
  const gameStats = value.gameStats as GameStatsRecord[];
  const accountStats = value.accountStats as AccountStatsRecord[];
  const messagesById = new Map(directMessages.map((message) => [message.id, message]));
  const runtime = value.runtime as RuntimeSnapshot | null;
  const accountIds = new Set(accounts.map((account) => account.id));
  const emojiCounts = new Map<string, number>();
  for (const emoji of emojis) {
    emojiCounts.set(emoji.accountId, (emojiCounts.get(emoji.accountId) ?? 0) + 1);
  }
  const validReferences =
    sessions.every((session) => accountIds.has(session.accountId)) &&
    friendships.every(
      (friendship) =>
        accountIds.has(friendship.requesterId) && accountIds.has(friendship.recipientId),
    ) &&
    matches.every((match) => match.accountIds.some((id) => accountIds.has(id)) &&
      match.accountIds.every((id) => accountIds.has(id) || botId(id))) &&
    emojis.every((emoji) => accountIds.has(emoji.accountId)) &&
    directMessages.every((message) => accountIds.has(message.senderId) && accountIds.has(message.recipientId)) &&
    messageReads.every((cursor) => {
      const message = messagesById.get(cursor.messageId);
      return message?.recipientId === cursor.accountId && message.senderId === cursor.otherId;
    }) &&
    friendNotifications.every((notification) => accountIds.has(notification.accountId) && accountIds.has(notification.actorId)) &&
    gameStats.every((stats) => accountIds.has(stats.accountId)) &&
    accountStats.every((stats) => accountIds.has(stats.accountId)) &&
    [...emojiCounts.values()].every((count) => count <= MAX_EMOJIS_PER_ACCOUNT) &&
    (runtime === null ||
      (runtime.players.every((player) => accountIds.has(player.info.id)) &&
        runtime.games.every((game) =>
          Object.values(game.players).every((player) => player.isBot
            ? botId(player.id) && !accountIds.has(player.id) : accountIds.has(player.id)),
        ) &&
        runtime.chat.every((room) =>
          room.messages.every((message) => accountIds.has(message.sender.id)),
        )));
  if (
    !validReferences ||
    !unique(accounts.map((a) => a.id)) ||
    !unique(accounts.map((a) => a.usernameNormalized)) ||
    !unique(sessions.map((s) => s.tokenHash)) ||
    !unique(friendships.map((f) => f.id)) ||
    !unique(friendships.map((f) => [f.requesterId, f.recipientId].sort().join(':'))) ||
    !unique(matches.map((m) => m.id)) ||
    !unique(emojis.map((e) => e.id)) ||
    !unique(emojis.map((e) => JSON.stringify([e.accountId, e.name]))) ||
    !unique(directMessages.map((message) => message.id)) ||
    !unique(directMessages.map((message) => JSON.stringify([message.senderId, message.clientId]))) ||
    !unique(messageReads.map((cursor) => JSON.stringify([cursor.accountId, cursor.otherId]))) ||
    !unique(friendNotifications.map((notification) => notification.id)) ||
    !unique(gameStats.map((stats) => gameStatsKey(stats.accountId, stats.gameType, stats.scope))) ||
    !unique(accountStats.map((stats) => accountStatsKey(stats.accountId, stats.scope)))
  ) {
    throw new Error(
      'Database has invalid references or duplicate records. The original file was preserved.',
    );
  }
}

export function emptyDocument(): DatabaseDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    accounts: [],
    sessions: [],
    friendships: [],
    matches: [],
    emojis: [],
    directMessages: [],
    messageReads: [],
    friendNotifications: [],
    gameStats: [],
    accountStats: [],
    runtime: null,
  };
}
