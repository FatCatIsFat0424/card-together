import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getShopItem, isAvatarBorderId, ownsShopItem, GAME_COIN_REWARD, MAX_EMOJIS_PER_ACCOUNT } from '@shared/constants';
import type { Repository, AccountRecord, MatchRecord } from './repository';
import { publicAccount, repositoryError, SOCIAL_HISTORY_RETENTION_MS } from './repository';
import { emptyDocument, isObject, validDirectMessage, validateDocument } from './schema';
import { migrateDocument } from './migrations';
import type { DatabaseDocument } from './schema';
import type { ShopItemId } from '@shared/types';
import { equipmentError } from './shop-equipment';
import type { RuntimeSnapshot } from '../runtime/types';
import { createDatabaseIndexes, friendshipPair } from './indexes';

const activePaths = new Set<string>();

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function boundedLimit(limit: number, maximum: number): number {
  return Math.trunc(Math.min(Math.max(limit, 0), maximum)) || 0;
}

export interface JsonRepositoryOptions {
  readonly now?: () => number;
}

/** A single server process owns a JSON file. A SQL adapter can implement Repository unchanged. */
export async function createJsonRepository(filePath: string, options: JsonRepositoryOptions = {}): Promise<Repository> {
  const now = options.now ?? Date.now;
  const path = resolve(filePath);
  const pathKey = process.platform === 'win32' ? path.toLowerCase() : path;
  if (activePaths.has(pathKey))
    throw repositoryError(
      'DATABASE_IN_USE',
      'This database is already open. Close its repository before opening another.',
    );
  activePaths.add(pathKey);
  try {
    await mkdir(dirname(path), { recursive: true });
    let document: DatabaseDocument;
    let queue: Promise<void> = Promise.resolve();
    let closed = false;
    const indexes = createDatabaseIndexes();

    async function persist(next: DatabaseDocument): Promise<void> {
      validateDocument(next);
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, path);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    if (parsed === undefined) {
      document = emptyDocument();
      await persist(document);
    } else {
      const migrated = migrateDocument(parsed);
      validateDocument(migrated);
      document = migrated;
      if (migrated !== parsed) {
        const version = isObject(parsed) ? String(parsed.schemaVersion) : 'old';
        await copyFile(path, `${path}.v${version}.bak`);
        await persist(document);
      }
    }

    async function read<T>(select: (data: DatabaseDocument) => T): Promise<T> {
      await queue;
      return structuredClone(select(document));
    }

    function write<T>(
      copiedTables: readonly ('accounts' | 'sessions' | 'friendships' | 'matches' | 'emojis' | 'directMessages' | 'messageReads' | 'friendNotifications')[],
      update: (data: DatabaseDocument) => T,
    ): Promise<T> {
      if (closed) return Promise.reject(new Error('Repository is closed.'));
      const operation = queue.then(async () => {
        // Copy only arrays this operation mutates. Existing records remain immutable;
        // replacements and external input are copied before a successful publication.
        const next = { ...document };
        for (const table of copiedTables) Object.assign(next, { [table]: document[table].slice() });
        const result = update(next);
        await persist(next);
        document = next;
        return structuredClone(result);
      });
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    }

    function upsertMatches(data: DatabaseDocument, matches: readonly MatchRecord[]): void {
      if (matches.length === 0) return;
      data.matches = data.matches.slice();
      // The local positions also see earlier entries in this batch, including duplicate IDs.
      const positions = new Map(indexes.matches(document.matches).positions);
      for (const match of matches) {
        const position = positions.get(match.id);
        if (position === undefined) {
          positions.set(match.id, data.matches.length);
          data.matches.push(structuredClone(match));
        } else data.matches[position] = structuredClone(match);
      }
    }

    function awardGameCoins(data: DatabaseDocument, snapshot: RuntimeSnapshot, completedGameIds: readonly string[]): void {
      if (completedGameIds.length === 0) return;
      const rewarded = new Set(data.rewardedGameIds ?? []);
      const positions = indexes.accounts(document.accounts).positions;
      data.accounts = data.accounts.slice();
      for (const id of completedGameIds) {
        if (rewarded.has(id)) continue;
        const game = snapshot.games.find((entry) => entry.id === id);
        if (!game?.result) throw new Error('Coin rewards require a completed game.');
        const humans = new Set(Object.values(game.players).filter((player) => !player.isBot).map((player) => player.id));
        for (const accountId of humans) {
          const index = positions.get(accountId);
          if (index === undefined) throw new Error('Coin reward account does not exist.');
          const account = data.accounts[index];
          const coins = (account.coins ?? 0) + GAME_COIN_REWARD;
          if (!Number.isSafeInteger(coins)) throw new Error('Coin balance exceeds the supported limit.');
          data.accounts[index] = { ...account, coins, coinRevision: (account.coinRevision ?? 0) + 1 };
        }
        rewarded.add(id);
      }
      data.rewardedGameIds = [...rewarded];
    }

    function purchaseShopItem(id: string, itemId: ShopItemId, now: number): Promise<AccountRecord | null> {
      return write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const account = data.accounts[index];
        const item = getShopItem(itemId);
        if (!item) throw repositoryError('INVALID_SHOP_ITEM', 'Choose an available shop item.');
        if (ownsShopItem(account, item)) return account;
        if ((account.coins ?? 0) < item.price) {
          throw repositoryError('INSUFFICIENT_COINS', 'Not enough coins. Play more games to earn coins.');
        }
        const inventory = item.type === 'avatarBorder'
          ? { ownedAvatarBorders: [...(account.ownedAvatarBorders ?? []), item.id] }
          : { ownedShopItems: [...(account.ownedShopItems ?? []), item.id] };
        const updated: AccountRecord = { ...account, ...inventory,
          coins: (account.coins ?? 0) - item.price,
          coinRevision: (account.coinRevision ?? 0) + 1,
          updatedAt: Math.max(now, account.updatedAt + 1) };
        data.accounts[index] = updated;
        return updated;
      });
    }

    return {
      getAccountById: (id) => read((data) => indexes.accounts(data.accounts).byId.get(id) ?? null),
      getAccountByUsername: (usernameNormalized) =>
        read((data) => indexes.accounts(data.accounts).byUsername.get(usernameNormalized) ?? null),
      searchAccounts: (query, excludeId, limit = 20) =>
        read((data) => {
          const count = boundedLimit(limit, 50);
          if (count === 0) return [];
          const normalizedQuery = query.toLowerCase();
          const matches: AccountRecord[] = [];
          for (const account of data.accounts) {
            if (
              account.id !== excludeId &&
              (account.usernameNormalized.includes(normalizedQuery) ||
                account.nickname.toLowerCase().includes(normalizedQuery))
            ) {
              matches.push(account);
              if (matches.length === count) break;
            }
          }
          return matches.map(publicAccount);
        }),
      createAccount: (account) =>
        write(['accounts'], (data) => {
          if (
            indexes.accounts(document.accounts).byId.has(account.id) ||
            indexes.accounts(document.accounts).byUsername.has(account.usernameNormalized)
          ) {
            throw repositoryError('USERNAME_EXISTS', 'Username is already taken.');
          }
          data.accounts.push(structuredClone(account));
          return account;
        }),
      updateProfile: (id, profile, now) =>
        write(['accounts'], (data) => {
          const index = indexes.accounts(document.accounts).positions.get(id);
          if (index === undefined) return null;
          if (profile.avatarBorder && !data.accounts[index].ownedAvatarBorders?.includes(profile.avatarBorder)) {
            throw repositoryError('BORDER_NOT_OWNED', 'Purchase this avatar border first.');
          }
          const invalidEquipment = equipmentError(profile, data.accounts[index]);
          if (invalidEquipment) throw repositoryError(invalidEquipment, 'Choose an owned item for this equipment slot.');
          const account: AccountRecord = { ...data.accounts[index], ...profile,
            updatedAt: Math.max(now, data.accounts[index].updatedAt + 1) };
          data.accounts[index] = account;
          return account;
        }),
      purchaseAvatarBorder: (id, border, now) => {
        if (!isAvatarBorderId(border)) return Promise.reject(repositoryError('INVALID_BORDER', 'Choose an available avatar border.'));
        return purchaseShopItem(id, border, now);
      },
      purchaseShopItem,
      changePassword: (id, expectedHash, passwordHash, now) =>
        write(['accounts'], (data) => {
          const index = indexes.accounts(document.accounts).positions.get(id);
          if (index === undefined || data.accounts[index].passwordHash !== expectedHash)
            return false;
          data.accounts[index] = { ...data.accounts[index], passwordHash, updatedAt: now };
          data.sessions = data.sessions.filter((session) => session.accountId !== id);
          return true;
        }),
      createSession: (session, expectedPasswordHash) =>
        write([], (data) => {
          if (
            indexes.accounts(document.accounts).byId.get(session.accountId)?.passwordHash !==
            expectedPasswordHash
          )
            return false;
          data.sessions = data.sessions.filter((s) => s.expiresAt > session.createdAt);
          data.sessions.push(structuredClone(session));
          return true;
        }),
      getSession: (hash) => read((data) => indexes.sessions(data.sessions).get(hash) ?? null),
      deleteSession: (hash) =>
        write([], (data) => {
          data.sessions = data.sessions.filter((s) => s.tokenHash !== hash);
        }),
      deleteAccountSessions: (accountId) =>
        write([], (data) => {
          data.sessions = data.sessions.filter((s) => s.accountId !== accountId);
        }),
      listFriendships: (accountId) =>
        read((data) => indexes.friendships(data.friendships).byAccount.get(accountId) ?? []),
      getFriendship: (id) =>
        read((data) => indexes.friendships(data.friendships).byId.get(id) ?? null),
      createFriendship: (friendship) =>
        write(['friendships'], (data) => {
          const { requesterId, recipientId } = friendship;
          if (
            requesterId === recipientId ||
            !indexes.accounts(document.accounts).byId.has(requesterId) ||
            !indexes.accounts(document.accounts).byId.has(recipientId)
          ) {
            throw repositoryError('INVALID_FRIENDSHIP', 'Invalid friend request.');
          }
          if (
            indexes
              .friendships(document.friendships)
              .pairs.has(friendshipPair(requesterId, recipientId))
          ) {
            throw repositoryError('FRIENDSHIP_EXISTS', 'A friendship or request already exists.');
          }
          data.friendships.push(structuredClone(friendship));
          return friendship;
        }),
      acceptFriendship: (id, recipientId) =>
        write(['friendships', 'friendNotifications'], (data) => {
          const index = indexes.friendships(document.friendships).positions.get(id);
          if (
            index === undefined ||
            data.friendships[index].recipientId !== recipientId ||
            data.friendships[index].status !== 'pending'
          )
            return null;
          const friendship = {
            ...data.friendships[index],
            status: 'accepted' as const,
            updatedAt: now(),
          };
          data.friendships[index] = friendship;
          data.friendNotifications.push({ id: randomUUID(), accountId: friendship.requesterId,
            actorId: recipientId, createdAt: friendship.updatedAt });
          return friendship;
        }),
      deleteFriendship: (id, accountId, expectedStatus) =>
        write(['friendships'], (data) => {
          const index = indexes.friendships(document.friendships).positions.get(id);
          if (index === undefined) return false;
          const friendship = data.friendships[index];
          if (
            (friendship.requesterId !== accountId && friendship.recipientId !== accountId) ||
            (expectedStatus !== undefined && friendship.status !== expectedStatus)
          )
            return false;
          data.friendships.splice(index, 1);
          return true;
        }),
      listDirectMessages: (accountId, otherId) => read((data) => {
        const messages = indexes.directMessages(data.directMessages);
        const records = otherId === undefined
          ? messages.byAccount.get(accountId)
          : messages.byPair.get(friendshipPair(accountId, otherId));
        const cutoff = now() - SOCIAL_HISTORY_RETENTION_MS;
        return (records ?? []).filter((message) => message.timestamp > cutoff);
      }),
      createDirectMessage: (input) => {
        const message = structuredClone(input);
        return write(['directMessages'], (data) => {
          if (!validDirectMessage(message)) {
            throw repositoryError('INVALID_MESSAGE', 'Invalid direct message.');
          }
          const messages = indexes.directMessages(document.directMessages);
          const existing = messages.byClient.get(JSON.stringify([message.senderId, message.clientId]));
          if (existing) {
            const { id: _existingId, timestamp: _existingTimestamp, ...previous } = existing;
            const { id: _requestedId, timestamp: _requestedTimestamp, ...requested } = message;
            if (!isDeepStrictEqual(previous, requested)) {
              throw repositoryError('MESSAGE_CONFLICT', 'This message request was already used for different content.');
            }
            if (existing.timestamp <= now() - SOCIAL_HISTORY_RETENTION_MS) {
              throw repositoryError('MESSAGE_EXPIRED', 'This message has expired. Send a new message.');
            }
            return existing;
          }
          if (messages.byId.has(message.id) || message.timestamp > now() ||
            message.timestamp <= now() - SOCIAL_HISTORY_RETENTION_MS) {
            throw repositoryError('INVALID_MESSAGE', 'Invalid direct message.');
          }
          const friendship = indexes.friendships(document.friendships).byAccount.get(message.senderId)
            ?.find((record) => record.status === 'accepted' &&
              friendshipPair(record.requesterId, record.recipientId) === friendshipPair(message.senderId, message.recipientId));
          if (!friendship) throw repositoryError('NOT_FRIENDS', 'You can only send messages to friends.');
          data.directMessages.push(message);
          return message;
        });
      },
      listMessageReads: (accountId) => read((data) => {
        const messages = indexes.directMessages(data.directMessages).byId;
        const cutoff = now() - SOCIAL_HISTORY_RETENTION_MS;
        return data.messageReads.filter((cursor) => cursor.accountId === accountId &&
          (messages.get(cursor.messageId)?.timestamp ?? 0) > cutoff);
      }),
      markDirectMessagesRead: (accountId, otherId, messageId) => write(['messageReads'], (data) => {
        const messages = indexes.directMessages(document.directMessages);
        const message = messages.byId.get(messageId);
        if (!message || message.senderId !== otherId || message.recipientId !== accountId ||
          message.timestamp <= now() - SOCIAL_HISTORY_RETENTION_MS) {
          throw repositoryError('INVALID_MESSAGE_READ', 'Choose a retained message received from this friend.');
        }
        const position = data.messageReads.findIndex((cursor) => cursor.accountId === accountId && cursor.otherId === otherId);
        const cursor = { accountId, otherId, messageId };
        if (position === -1) data.messageReads.push(cursor);
        else {
          const previousOrder = messages.order.get(data.messageReads[position].messageId) ?? -1;
          if (messages.order.get(messageId)! > previousOrder) data.messageReads[position] = cursor;
        }
      }),
      listFriendNotifications: (accountId) => read((data) => {
        const cutoff = now() - SOCIAL_HISTORY_RETENTION_MS;
        return data.friendNotifications.filter((entry) => entry.accountId === accountId && entry.createdAt > cutoff)
          .sort((first, second) => second.createdAt - first.createdAt);
      }),
      dismissFriendNotifications: (accountId, ids) => write([], (data) => {
        const selected = new Set(ids);
        data.friendNotifications = data.friendNotifications.filter((entry) =>
          entry.accountId !== accountId || !selected.has(entry.id));
      }),
      pruneSocialHistory: (time) => write([], (data) => {
        if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid social history pruning time.');
        const cutoff = time - SOCIAL_HISTORY_RETENTION_MS;
        data.directMessages = data.directMessages.filter((message) => message.timestamp > cutoff);
        const retainedIds = new Set(data.directMessages.map((message) => message.id));
        data.messageReads = data.messageReads.filter((cursor) => retainedIds.has(cursor.messageId));
        data.friendNotifications = data.friendNotifications.filter((entry) => entry.createdAt > cutoff);
      }),
      loadRuntime: () => read((data) => data.runtime),
      saveRuntime: (snapshot, matches = [], completedGameIds = []) =>
        write([], (data) => {
          data.runtime = structuredClone(snapshot);
          upsertMatches(data, matches);
          awardGameCoins(data, snapshot, completedGameIds);
        }),
      saveMatch: (match) =>
        write([], (data) => {
          upsertMatches(data, [match]);
        }),
      listMatches: (accountId, limit) =>
        read((data) => {
          const matches = (indexes.matches(data.matches).byAccount.get(accountId) ?? [])
            .filter((match) => !match.accountIds.some((id) => id.startsWith('bot:')));
          return limit === undefined ? matches : matches.slice(0, boundedLimit(limit, 100));
        }),
      listEmojis: (accountId) =>
        read((data) => data.emojis.filter((emoji) => emoji.accountId === accountId)),
      createEmojis: (accountId, items, now) =>
        write(['emojis'], (data) => {
          const names = new Set(
            data.emojis.filter((emoji) => emoji.accountId === accountId).map((emoji) => emoji.name),
          );
          if (names.size + items.length > MAX_EMOJIS_PER_ACCOUNT)
            throw repositoryError('EMOJI_LIMIT', 'Emoji library is full.');
          const created = items.map(({ name, mediaId }) => {
            if (names.has(name)) throw repositoryError('EMOJI_EXISTS', `Emoji :${name}: already exists.`);
            names.add(name);
            return { id: randomUUID(), accountId, name, mediaId, createdAt: now };
          });
          data.emojis.push(...created);
          return created;
        }),
      deleteEmoji: (accountId, id) =>
        write(['emojis'], (data) => {
          const index = data.emojis.findIndex(
            (emoji) => emoji.id === id && emoji.accountId === accountId,
          );
          if (index === -1) return false;
          data.emojis.splice(index, 1);
          return true;
        }),
      deleteEmojis: (accountId, ids) =>
        write(['emojis'], (data) => {
          const requested = new Set(ids);
          const deleted: string[] = [];
          data.emojis = data.emojis.filter((emoji) => {
            const remove = emoji.accountId === accountId && requested.has(emoji.id);
            if (remove) deleted.push(emoji.id);
            return !remove;
          });
          return deleted;
        }),
      renameEmoji: (accountId, id, name) =>
        write(['emojis'], (data) => {
          const index = data.emojis.findIndex(
            (emoji) => emoji.id === id && emoji.accountId === accountId,
          );
          if (index === -1) return null;
          if (data.emojis.some((emoji) => emoji.accountId === accountId && emoji.name === name &&
            emoji.id !== id))
            throw repositoryError('EMOJI_EXISTS', `Emoji :${name}: already exists.`);
          const emoji = { ...data.emojis[index], name };
          data.emojis[index] = emoji;
          return emoji;
        }),
      close: async () => {
        if (closed) {
          await queue;
          return;
        }
        closed = true;
        await queue;
        activePaths.delete(pathKey);
      },
    };
  } catch (error) {
    activePaths.delete(pathKey);
    throw error;
  }
}
