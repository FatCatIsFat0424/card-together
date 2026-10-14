import {
  isBigTwoResult, isBlackjackResult, isChinesePokerResult, isHoldemResult, isLiarsDeckResult, isNinetyNineResult,
  isRedPointsResult, isRuntimeSnapshot, isSevensResult,
} from '../runtime/validate';
import {
  FLEXIBLE_SEAT_GAMES, GAME_TYPES, MAX_EMOJIS_PER_ACCOUNT, MAX_MESSAGE_EMOJIS, NICKNAME_MAX_LENGTH, isEmojiName, isImageOpacity, isMediaId,
  isUsername, isAvatarBorderId, isProvidedEmojiFile, getShopItem, isShopStickerId,
} from '@shared/constants';
import type { GameType } from '@shared/types';
import type { RuntimeSnapshot } from '../runtime/types';
import type {
  AccountRecord, DirectMessageRecord, EmojiRecord, FriendNotificationRecord, FriendshipRecord, MatchRecord, MessageReadRecord, SessionRecord,
} from './repository';
import { equipmentError } from './shop-equipment';
import type { ShopItemId } from '@shared/types';
import { CURRENT_SCHEMA_VERSION } from './migrations';

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
  runtime: RuntimeSnapshot | null;
  /** Durable receipts prevent replayed completions from awarding coins twice. */
  rewardedGameIds?: string[];
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

function botId(id: string): boolean {
  return /^bot:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function validAccount(value: unknown): value is AccountRecord {
  return (
    isObject(value) &&
    nonEmpty(value.id) &&
    typeof value.username === 'string' &&
    isUsername(value.username) &&
    (value.coins === undefined || timestamp(value.coins)) &&
    (value.coinRevision === undefined || timestamp(value.coinRevision)) &&
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
    equipmentError(value, { ownedShopItems: value.ownedShopItems as readonly ShopItemId[] | undefined }) === null &&
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

function validSession(value: unknown): value is SessionRecord {
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

function validFriendship(value: unknown): value is FriendshipRecord {
  return (
    isObject(value) &&
    nonEmpty(value.id) &&
    nonEmpty(value.requesterId) &&
    nonEmpty(value.recipientId) &&
    value.requesterId !== value.recipientId &&
    (value.status === 'pending' || value.status === 'accepted') &&
    timestamp(value.createdAt) &&
    timestamp(value.updatedAt)
  );
}

function validMatch(value: unknown): value is MatchRecord {
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
  // Blackjack and Hold'em results list the seats that took part; every other match had four.
  const participants = FLEXIBLE_SEAT_GAMES.includes(value.result.gameType as GameType) ? value.result.seats : undefined;
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
  };
  const gameType = value.result.gameType;
  return typeof gameType === 'string' && GAME_TYPES.includes(gameType as GameType) &&
    validators[gameType as GameType](value.result);
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

function validEmoji(value: unknown): value is EmojiRecord {
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

function validMessageRead(value: unknown): value is MessageReadRecord {
  return isObject(value) && nonEmpty(value.accountId) && nonEmpty(value.otherId) &&
    value.accountId !== value.otherId && nonEmpty(value.messageId);
}

function validFriendNotification(value: unknown): value is FriendNotificationRecord {
  return isObject(value) && nonEmpty(value.id) && nonEmpty(value.accountId) && nonEmpty(value.actorId) &&
    value.accountId !== value.actorId && timestamp(value.createdAt);
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/** Reject incompatible or corrupt data instead of replacing a user's database. */
export function validateDocument(value: unknown): asserts value is DatabaseDocument {
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
    (value.rewardedGameIds !== undefined && (!Array.isArray(value.rewardedGameIds)
      || !value.rewardedGameIds.every(nonEmpty) || !unique(value.rewardedGameIds))) ||
    !(value.runtime === null || isRuntimeSnapshot(value.runtime))
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
    !unique(friendNotifications.map((notification) => notification.id))
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
    runtime: null,
  };
}
