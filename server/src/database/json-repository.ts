import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isAvatarBorderId, MAX_EMOJIS_PER_ACCOUNT } from '@shared/constants';
import { isReplayRecordId } from '@shared/replay-session';
import type { Repository, RepositoryOptions, AccountRecord, MatchRecord, NewMatchRecord } from './repository';
import { MAX_MATCHES_PER_ACCOUNT, publicAccount, repositoryError, SOCIAL_HISTORY_RETENTION_MS } from './repository';
import { emptyDocument, isObject, validDirectMessage, validateDocument } from './schema';
import { migrateDocument } from './migrations';
import type { DatabaseDocument } from './schema';
import type { MatchReplay, ShopItemId } from '@shared/types';
import { createStatsStage, napoleonRoleTotals, playerStats, replayFrame } from './game-stats';
import type { StatsStage } from './game-stats';
import { applyStatsStage, documentStatsSource } from './json-stats';
import type { AccountHistory } from './stats-backfill';
import { backfillGameStats } from './stats-backfill';
import { dropUnplayableRecordings, isMatchReplay } from './match-replay';
import { storedMatches } from './stored-matches';
import { createReplayStore } from './replay-store';
import { retainMatches } from './match-retention';
import { backupMatchHistoryState } from './state-backup';
import type { RuntimeSnapshot } from '../runtime/types';
import { createDatabaseIndexes, friendshipPair } from './indexes';
import type { DatabaseLock } from './owner-lock';
import { acquireDatabaseLock } from './owner-lock';
import { dailyStatus, recentGameCounts } from './daily-rewards';
import type { RecentGames } from './daily-rewards';
import { achievementsStatus } from './achievements';
import {
  achievementClaim, completedGame, dailyRewardClaim, dailyTaskReplacement, gameRewardedAccount, observedLastSeen,
  profileUpdatedAccount, purchasedAccount, rewardedHumans,
} from './account-operations';

const activePaths = new Set<string>();

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function boundedLimit(limit: number, maximum: number): number {
  return Math.trunc(Math.min(Math.max(limit, 0), maximum)) || 0;
}

export type JsonRepositoryOptions = RepositoryOptions;

type CopiedTable = 'accounts' | 'sessions' | 'friendships' | 'matches' | 'emojis' | 'directMessages' | 'messageReads'
  | 'friendNotifications';

/** A single server process owns a JSON file, enforced across processes by its lock file. */
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
  let lock: DatabaseLock | undefined;
  try {
    await mkdir(dirname(path), { recursive: true });
    lock = await acquireDatabaseLock(path);
    const ownerLock: DatabaseLock = lock;
    let document: DatabaseDocument;
    let queue: Promise<void> = Promise.resolve();
    let closed = false;
    const indexes = createDatabaseIndexes();
    const replays = createReplayStore(options.replayDirectory ?? join(dirname(path), 'replays'));
    /** Matches whose unavailable archive was already reported. */
    const reportedReplays = new Set<string>();

    async function persist(next: DatabaseDocument): Promise<void> {
      // Loading applies every runtime recording step; frequent writes check their structure.
      validateDocument(next, { applyReplaySteps: false });
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(next)}\n`, 'utf8');
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
      for (const gameId of dropUnplayableRecordings(migrated)) {
        console.warn(`[database] Dropped an unplayable replay recording; game ${gameId} continues unrecorded.`);
      }
      validateDocument(migrated);
      document = migrated;
      if (migrated !== parsed) {
        const version = isObject(parsed) ? String(parsed.schemaVersion) : 'old';
        await copyFile(path, `${path}.v${version}.bak`);
        await persist(document);
      }
    }
    const retained = retainMatches(document.matches);
    if (retained.length !== document.matches.length) {
      await backupMatchHistoryState(path, await readFile(path, 'utf8'), options.replayDirectory);
      const next = { ...document, matches: retained };
      await persist(next);
      document = next;
    }
    // Archives written before a failed commit or left by a crash have no flagged match.
    const unavailable = await replays.sweep(new Set(document.matches.flatMap((match) => match.hasReplay ? [match.id] : [])));
    for (const matchId of unavailable) reportedReplays.add(matchId);
    if (unavailable.length > 0) {
      console.warn(`[replays] ${unavailable.length} recorded matches have no archive file; they show no replay.`);
    }
    await backfillStats();

    /** Counts stored matches into the v9 statistics before the repository serves any game. */
    async function backfillStats(): Promise<void> {
      if (!document.statsBackfill) return;
      let ordered: MatchRecord[] | null = null;
      const result = await backfillGameStats({
        game: (accountId, gameType, scope) => documentStatsSource(document).game(accountId, gameType, scope),
        account: (accountId, scope) => documentStatsSource(document).account(accountId, scope),
        state: async () => document.statsBackfill ?? null,
        histories: async () => {
          const histories = new Map<string, AccountHistory>();
          for (const match of document.matches) {
            for (const accountId of match.accountIds) {
              const history = histories.get(accountId);
              histories.set(accountId, { matches: (history?.matches ?? 0) + 1,
                oldest: Math.min(history?.oldest ?? match.finishedAt, match.finishedAt), completed: 0 });
            }
          }
          for (const account of document.accounts) {
            const history = histories.get(account.id);
            if (history) histories.set(account.id, { ...history, completed: account.achievements?.games ?? 0 });
          }
          return histories;
        },
        isAccount: (accountId) => indexes.accounts(document.accounts).byId.has(accountId),
        matches: async (after, limit) => {
          const sorted = ordered ?? [...document.matches].sort((first, second) => first.finishedAt - second.finishedAt
            || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
          ordered = sorted;
          const start = after === null ? 0 : sorted.findIndex((match) =>
            match.finishedAt > after.at || (match.finishedAt === after.at && match.id > after.matchId));
          return start === -1 ? [] : sorted.slice(start, start + limit);
        },
        replay: async (match) => {
          const replay = await replays.read(match.id);
          if (replay !== undefined && !isMatchReplay(replay, match.result, match.finishedAt)) throw new Error('Invalid replay archive.');
          return replay as MatchReplay | undefined;
        },
        commit: async (stage, next) => {
          const updated: DatabaseDocument = { ...document };
          applyStatsStage(updated, stage);
          if (next) updated.statsBackfill = next;
          else delete updated.statsBackfill;
          await persist(updated);
          document = updated;
        },
      });
      if (result) console.warn(`[stats] Counted ${result.matches} stored matches (${result.logged} with replay logs).`);
    }

    async function read<T>(select: (data: DatabaseDocument) => T): Promise<T> {
      await queue;
      return structuredClone(select(document));
    }

    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error('Repository is closed.'));
      const result = queue.then(operation);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }

    /** Runs inside the queue: validates, persists, then publishes the next document. */
    async function commit<T>(copiedTables: readonly CopiedTable[], update: (data: DatabaseDocument) => T): Promise<T> {
      // Copy only arrays this operation mutates. Existing records remain immutable;
      // replacements and external input are copied before a successful publication.
      const next = { ...document };
      for (const table of copiedTables) Object.assign(next, { [table]: document[table].slice() });
      const result = update(next);
      await persist(next);
      document = next;
      return structuredClone(result);
    }

    function write<T>(copiedTables: readonly CopiedTable[], update: (data: DatabaseDocument) => T): Promise<T> {
      return enqueue(() => commit(copiedTables, update));
    }

    function flaggedIds(matches: readonly MatchRecord[], ids: Iterable<string>): Set<string> {
      const positions = indexes.matches(matches).positions;
      const flagged = new Set<string>();
      for (const id of ids) {
        const position = positions.get(id);
        if (position !== undefined && matches[position].hasReplay) flagged.add(id);
      }
      return flagged;
    }

    /**
     * Archives are written before the commit that flags their matches, and archives the commit
     * unflags are deleted only after it succeeds, so a flag never points to a file deleted early.
     */
    function saveMatches(matches: readonly NewMatchRecord[], update: (data: DatabaseDocument) => void): Promise<void> {
      return enqueue(async () => {
        const { records, archives } = storedMatches(matches);
        const written: string[] = [];
        let unflagged: string[];
        try {
          for (const [matchId, replay] of archives) {
            await replays.write(matchId, replay);
            written.push(matchId);
          }
          unflagged = await commit([], (data) => {
            update(data);
            return upsertMatches(data, records);
          });
        } catch (error) {
          // Keep files that a committed match still flags; startup sweeps anything left.
          const committed = flaggedIds(document.matches, written);
          await replays.remove(written.filter((matchId) => !committed.has(matchId)));
          throw error;
        }
        await replays.remove(unflagged);
      });
    }

    /** Favorite games from the published per-account history index; today's commit cannot affect the window. */
    function recentGames(accountId: string, timestamp: number): RecentGames {
      return () => recentGameCounts(indexes.matches(document.matches).byAccount.get(accountId) ?? [], timestamp);
    }

    /** Upserts results and prunes history atomically; archive deletion follows a successful commit. */
    function upsertMatches(data: DatabaseDocument, matches: readonly MatchRecord[]): string[] {
      if (matches.length === 0) return [];
      const previous = new Map(data.matches.filter((match) => match.hasReplay).map((match) => [match.id, match]));
      data.matches = data.matches.slice();
      // The local positions also see earlier entries in this batch, including duplicate IDs.
      const positions = new Map(indexes.matches(document.matches).positions);
      for (const match of matches) {
        const position = positions.get(match.id);
        if (position === undefined) {
          positions.set(match.id, data.matches.length);
          data.matches.push(structuredClone(match));
        } else data.matches[position] = structuredClone(match);
        if (match.hasReplay) previous.set(match.id, match);
      }
      data.matches = retainMatches(data.matches);
      const flagged = new Set(data.matches.filter((match) => match.hasReplay).map((match) => match.id));
      return [...previous.keys()].filter((id) => !flagged.has(id));
    }

    function recordLastSeen(data: DatabaseDocument, snapshot: RuntimeSnapshot): void {
      const timestamp = now();
      const positions = indexes.accounts(document.accounts).positions;
      let copied = false;
      for (const player of snapshot.players) {
        const index = positions.get(player.info.id);
        if (index === undefined) continue;
        const account = data.accounts[index];
        const lastSeenAt = observedLastSeen(player, timestamp);
        if (lastSeenAt === null) continue;
        if (account.lastSeenAt !== undefined && account.lastSeenAt >= lastSeenAt) continue;
        if (!copied) {
          data.accounts = data.accounts.slice();
          copied = true;
        }
        data.accounts[index] = { ...account, lastSeenAt };
      }
    }

    /** Returns the games rewarded by this commit; completions already receipted are skipped. */
    function awardGameCoins(data: DatabaseDocument, snapshot: RuntimeSnapshot, completedGameIds: readonly string[]): string[] {
      if (completedGameIds.length === 0) return [];
      const rewarded = new Set(data.rewardedGameIds ?? []);
      const newlyRewarded: string[] = [];
      const rewardedAt = now();
      const positions = indexes.accounts(document.accounts).positions;
      data.accounts = data.accounts.slice();
      for (const id of completedGameIds) {
        if (rewarded.has(id)) continue;
        const game = completedGame(snapshot.games, id);
        for (const accountId of rewardedHumans(game)) {
          const index = positions.get(accountId);
          if (index === undefined) throw new Error('Coin reward account does not exist.');
          data.accounts[index] = gameRewardedAccount(data.accounts[index], game, rewardedAt, recentGames(accountId, rewardedAt));
        }
        rewarded.add(id);
        newlyRewarded.push(id);
      }
      data.rewardedGameIds = [...rewarded];
      return newlyRewarded;
    }

    /** Statistics count each match once, under the same receipt as its rewards. */
    function countGameStats(data: DatabaseDocument, matches: readonly NewMatchRecord[], rewardedIds: readonly string[]): void {
      const counted = new Set(rewardedIds);
      const stage: StatsStage = createStatsStage(documentStatsSource(data),
        (accountId) => indexes.accounts(data.accounts).byId.has(accountId));
      for (const match of matches) {
        if (counted.delete(match.id)) stage.count(match, replayFrame(match.replay));
      }
      applyStatsStage(data, stage);
    }

    function purchaseShopItem(id: string, itemId: ShopItemId, now: number, equip = false): Promise<AccountRecord | null> {
      return write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const updated = purchasedAccount(data.accounts[index], itemId, now, equip);
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
          const account = profileUpdatedAccount(data.accounts[index], profile, now);
          data.accounts[index] = account;
          return account;
        }),
      purchaseAvatarBorder: (id, border, now) => {
        if (!isAvatarBorderId(border)) return Promise.reject(repositoryError('INVALID_BORDER', 'Choose an available avatar border.'));
        return purchaseShopItem(id, border, now);
      },
      purchaseShopItem,
      getAchievements: (id) => read((data) => {
        const account = indexes.accounts(data.accounts).byId.get(id);
        return account ? achievementsStatus(account) : null;
      }),
      claimAchievement: (id, categoryId) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const claimed = achievementClaim(data.accounts[index], categoryId, now());
        data.accounts[index] = claimed.account;
        return claimed;
      }),
      getDailyRewards: (id) => read((data) => {
        const account = indexes.accounts(data.accounts).byId.get(id);
        const timestamp = now();
        return account ? dailyStatus(account.dailyRewards, timestamp, id, recentGames(id, timestamp)) : null;
      }),
      claimDailyReward: (id, reward, day) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const timestamp = now();
        const claimed = dailyRewardClaim(data.accounts[index], reward, day, timestamp, recentGames(id, timestamp));
        data.accounts[index] = claimed.account;
        return claimed;
      }),
      replaceDailyTask: (id, task, day) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const timestamp = now();
        const replaced = dailyTaskReplacement(data.accounts[index], task, day, timestamp, recentGames(id, timestamp));
        data.accounts[index] = replaced.account;
        return replaced;
      }),
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
      markFriendNotificationsRead: (accountId, ids) => write([], (data) => {
        const readAt = now();
        const selected = ids === 'all' ? null : new Set(ids);
        const chosen = (id: string): boolean => selected === null || selected.has(id);
        data.friendNotifications = data.friendNotifications.map((entry) =>
          entry.accountId === accountId && entry.readAt === undefined && chosen(entry.id) ? { ...entry, readAt } : entry);
        data.friendships = data.friendships.map((entry) => entry.recipientId === accountId && entry.status === 'pending'
          && entry.recipientReadAt === undefined && chosen(entry.id) ? { ...entry, recipientReadAt: readAt } : entry);
      }),
      dismissFriendNotifications: (accountId, ids) => write([], (data) => {
        const selected = new Set(ids);
        data.friendNotifications = data.friendNotifications.filter((entry) =>
          entry.accountId !== accountId || !selected.has(entry.id));
      }),
      clearReadFriendNotifications: (accountId) => write([], (data) => {
        const before = data.friendNotifications.length;
        data.friendNotifications = data.friendNotifications.filter((entry) =>
          entry.accountId !== accountId || entry.readAt === undefined);
        return before - data.friendNotifications.length;
      }),
      recordAccountActivity: (accountId, at) => write([], (data) => {
        if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid activity time.');
        const index = indexes.accounts(document.accounts).positions.get(accountId);
        if (index === undefined) return;
        const account = data.accounts[index];
        if (account.lastSeenAt !== undefined && account.lastSeenAt >= at) return;
        data.accounts = data.accounts.slice();
        data.accounts[index] = { ...account, lastSeenAt: at };
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
        saveMatches(matches, (data) => {
          data.runtime = structuredClone(snapshot);
          countGameStats(data, matches, awardGameCoins(data, snapshot, completedGameIds));
          recordLastSeen(data, snapshot);
        }),
      saveMatch: (match) => saveMatches([match], () => undefined),
      getPlayerStats: (accountId) => read((data) => playerStats(
        data.gameStats.filter((entry) => entry.accountId === accountId),
        data.accountStats.filter((entry) => entry.accountId === accountId),
        napoleonRoleTotals(data.gameStats))),
      listMatches: (accountId, limit) =>
        read((data) => {
          const matches = indexes.matches(data.matches).byAccount.get(accountId) ?? [];
          return matches.slice(0, limit === undefined ? MAX_MATCHES_PER_ACCOUNT : boundedLimit(limit, MAX_MATCHES_PER_ACCOUNT));
        }),
      getMatchReplay: async (matchId) => {
        if (!isReplayRecordId(matchId)) return undefined;
        const flaggedMatch = (): Promise<MatchRecord | undefined> => read((data) => {
          const position = indexes.matches(data.matches).positions.get(matchId);
          return position !== undefined && data.matches[position].hasReplay ? data.matches[position] : undefined;
        });
        const match = await flaggedMatch();
        if (!match) return undefined;
        let replay: unknown;
        let problem: string | undefined;
        try {
          replay = await replays.read(matchId);
          if (replay === undefined) {
            // Retention may have deleted it after this match was read; that is not damage.
            if (!(await flaggedMatch())) return undefined;
            problem = 'is missing';
          } else if (!isMatchReplay(replay, match.result, match.finishedAt)) problem = 'is invalid';
        } catch (error) {
          problem = `cannot be read (${error instanceof Error ? error.message : String(error)})`;
        }
        if (problem === undefined) return replay as MatchReplay;
        if (!reportedReplays.has(matchId)) {
          reportedReplays.add(matchId);
          console.error(`[replays] The archive of match ${matchId} ${problem}; it shows no replay.`);
        }
        return undefined;
      },
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
        await ownerLock.release();
        activePaths.delete(pathKey);
      },
    };
  } catch (error) {
    // The startup error matters more; a lock left behind is replaced once this process ends.
    await lock?.release().catch(() => undefined);
    activePaths.delete(pathKey);
    throw error;
  }
}
