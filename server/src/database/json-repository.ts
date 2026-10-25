import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { copyFile, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { getShopItem, isAvatarBorderId, ownsShopItem, GAME_COIN_REWARD, MAX_EMOJIS_PER_ACCOUNT } from '@shared/constants';
import { isReplayRecordId } from '@shared/replay-session';
import type { Repository, AccountRecord, MatchRecord, NewMatchRecord } from './repository';
import { MAX_REPLAYS_PER_PLAYER, publicAccount, repositoryError, SOCIAL_HISTORY_RETENTION_MS } from './repository';
import { emptyDocument, isObject, validDirectMessage, validateDocument } from './schema';
import { migrateDocument } from './migrations';
import type { DatabaseDocument } from './schema';
import type { MatchReplay, ShopItemId } from '@shared/types';
import { dropUnplayableRecordings, isMatchReplay } from './match-replay';
import { createReplayStore } from './replay-store';
import { equipmentError } from './shop-equipment';
import type { RuntimeSnapshot } from '../runtime/types';
import { createDatabaseIndexes, friendshipPair } from './indexes';
import { DAILY_TASKS, DAILY_CHECK_IN_COINS } from '@shared/constants/daily-rewards';
import { dailyGameProgress, dailyState, dailyStatus, replacementTask, taskProgress } from './daily-rewards';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import { achievementGameProgress, achievementState, achievementsStatus } from './achievements';

const activePaths = new Set<string>();

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function boundedLimit(limit: number, maximum: number): number {
  return Math.trunc(Math.min(Math.max(limit, 0), maximum)) || 0;
}

export interface JsonRepositoryOptions {
  readonly now?: () => number;
  /** Match replay archives; defaults to `replays/` beside the database file. */
  readonly replayDirectory?: string;
}

type CopiedTable = 'accounts' | 'sessions' | 'friendships' | 'matches' | 'emojis' | 'directMessages' | 'messageReads'
  | 'friendNotifications';

/** Splits incoming matches into stored records and the archives to write; later duplicates win. */
function storedMatches(matches: readonly NewMatchRecord[]): { records: MatchRecord[]; archives: Map<string, MatchReplay> } {
  const records: MatchRecord[] = [];
  const archives = new Map<string, MatchReplay>();
  for (const match of matches) {
    // Only a stored archive sets the flag, whatever the caller passed.
    const { replay, hasReplay: _hasReplay, ...fields } = structuredClone(match) as NewMatchRecord & { readonly hasReplay?: unknown };
    if (replay === undefined) {
      archives.delete(fields.id);
      records.push(fields);
      continue;
    }
    if (!isReplayRecordId(fields.id) || !isObject(fields.result) || !isMatchReplay(replay, fields.result, fields.finishedAt)) {
      throw repositoryError('INVALID_REPLAY', 'Invalid match replay archive.');
    }
    archives.set(fields.id, replay);
    records.push({ ...fields, hasReplay: true });
  }
  return { records, archives };
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
    // Archives written before a failed commit or left by a crash have no flagged match.
    const unavailable = await replays.sweep(new Set(document.matches.flatMap((match) => match.hasReplay ? [match.id] : [])));
    for (const matchId of unavailable) reportedReplays.add(matchId);
    if (unavailable.length > 0) {
      console.warn(`[replays] ${unavailable.length} recorded matches have no archive file; they show no replay.`);
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

    /** Upserts matches and applies replay retention; resolves the IDs whose archive was unflagged. */
    function upsertMatches(data: DatabaseDocument, matches: readonly MatchRecord[]): string[] {
      if (matches.length === 0) return [];
      data.matches = data.matches.slice();
      const batchIds = new Set(matches.map((match) => match.id));
      const previouslyFlagged = flaggedIds(document.matches, batchIds);
      // The local positions also see earlier entries in this batch, including duplicate IDs.
      const positions = new Map(indexes.matches(document.matches).positions);
      for (const match of matches) {
        const position = positions.get(match.id);
        if (position === undefined) {
          positions.set(match.id, data.matches.length);
          data.matches.push(structuredClone(match));
        } else data.matches[position] = structuredClone(match);
      }
      const unflagged = [...previouslyFlagged].filter((id) => !data.matches[positions.get(id)!].hasReplay);
      for (const id of pruneReplays(data, batchIds, positions)) {
        const position = positions.get(id)!;
        const { hasReplay: _pruned, ...record } = data.matches[position];
        data.matches[position] = record;
        unflagged.push(id);
      }
      return unflagged;
    }

    /**
     * Retention for the participants of this batch only: an archive stays while it is within
     * MAX_REPLAYS_PER_PLAYER of the newest recorded matches of any of its participants.
     */
    function pruneReplays(data: DatabaseDocument, batchIds: ReadonlySet<string>, positions: ReadonlyMap<string, number>): string[] {
      const batch = [...batchIds].map((id) => data.matches[positions.get(id)!]).filter((match) => match.hasReplay);
      if (batch.length === 0) return [];
      const previous = indexes.matches(document.matches).byAccount;
      const rankings = new Map<string, readonly MatchRecord[]>();
      function recordedNewestFirst(accountId: string): readonly MatchRecord[] {
        let ranking = rankings.get(accountId);
        if (ranking) return ranking;
        const unchanged = (previous.get(accountId) ?? []).filter((match) => !batchIds.has(match.id) && match.hasReplay);
        ranking = [...unchanged, ...batch.filter((match) => match.accountIds.includes(accountId))]
          .sort((first, second) => second.finishedAt - first.finishedAt
            || positions.get(second.id)! - positions.get(first.id)!);
        rankings.set(accountId, ranking);
        return ranking;
      }
      const retainedBy = (match: MatchRecord, accountId: string): boolean => {
        const rank = recordedNewestFirst(accountId).indexOf(match);
        return rank !== -1 && rank < MAX_REPLAYS_PER_PLAYER;
      };
      const pruned = new Set<string>();
      for (const accountId of new Set(batch.flatMap((match) => match.accountIds))) {
        for (const candidate of recordedNewestFirst(accountId).slice(MAX_REPLAYS_PER_PLAYER)) {
          if (!candidate.accountIds.some((participant) => retainedBy(candidate, participant))) pruned.add(candidate.id);
        }
      }
      return [...pruned];
    }

    function recordLastSeen(data: DatabaseDocument, snapshot: RuntimeSnapshot): void {
      const timestamp = now();
      const positions = indexes.accounts(document.accounts).positions;
      let copied = false;
      for (const player of snapshot.players) {
        const index = positions.get(player.info.id);
        if (index === undefined) continue;
        const account = data.accounts[index];
        const lastSeenAt = player.disconnectedAt === null ? timestamp
          : player.lastSeenAt === undefined ? player.disconnectedAt : player.lastSeenAt;
        if (lastSeenAt === null) continue;
        if (account.lastSeenAt !== undefined && account.lastSeenAt >= lastSeenAt) continue;
        if (!copied) {
          data.accounts = data.accounts.slice();
          copied = true;
        }
        data.accounts[index] = { ...account, lastSeenAt };
      }
    }

    function awardGameCoins(data: DatabaseDocument, snapshot: RuntimeSnapshot, completedGameIds: readonly string[]): void {
      if (completedGameIds.length === 0) return;
      const rewarded = new Set(data.rewardedGameIds ?? []);
      const rewardedAt = now();
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
          data.accounts[index] = { ...account, coins, coinRevision: (account.coinRevision ?? 0) + 1,
            achievements: achievementGameProgress(account.achievements, game, accountId),
            dailyRewards: dailyGameProgress(account.dailyRewards, game, accountId, rewardedAt) };
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
      getAchievements: (id) => read((data) => {
        const account = indexes.accounts(data.accounts).byId.get(id);
        return account ? achievementsStatus(account) : null;
      }),
      claimAchievement: (id, categoryId) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const account = data.accounts[index];
        const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === categoryId);
        if (!category) throw repositoryError('INVALID_ACHIEVEMENT', 'Choose an achievement category.');
        const status = achievementsStatus(account);
        const progress = status.categories.find((entry) => entry.id === categoryId)!;
        if (progress.claimed) return { account, achievements: status };
        if (!category.items.every((item) => progress.items.some((entry) => entry.id === item.id && entry.progress >= item.target))) {
          throw repositoryError('ACHIEVEMENT_INCOMPLETE', 'Complete every achievement in this category first.');
        }
        const updated: AccountRecord = { ...account,
          ownedAchievementNameplates: [...(account.ownedAchievementNameplates ?? []), category.reward],
          updatedAt: Math.max(now(), account.updatedAt + 1) };
        data.accounts[index] = updated;
        return { account: updated, achievements: achievementsStatus(updated) };
      }),
      getDailyRewards: (id) => read((data) => {
        const account = indexes.accounts(data.accounts).byId.get(id);
        return account ? dailyStatus(account.dailyRewards, now(), id) : null;
      }),
      claimDailyReward: (id, reward, day) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const account = data.accounts[index];
        const timestamp = now();
        const state = dailyState(account.dailyRewards, timestamp, id);
        if (day !== state.day) throw repositoryError('DAILY_DATE_CHANGED', 'Refresh today’s rewards.');
        const task = DAILY_TASKS.find((entry) => entry.id === reward);
        if (!task && reward !== 'check-in') throw repositoryError('INVALID_DAILY_REWARD', 'Choose an available daily reward.');
        const alreadyClaimed = reward === 'check-in' ? state.checkInDays.includes(day)
          : state.claimedTasks.includes(reward);
        if (task && !state.taskIds.includes(task.id)) throw repositoryError('DAILY_TASK_UNASSIGNED', 'This task is not assigned today.');
        if (alreadyClaimed) return { account, dailyRewards: dailyStatus(account.dailyRewards, timestamp, id) };
        if (task && taskProgress(state, task.id) < task.target) {
          throw repositoryError('DAILY_TASK_INCOMPLETE', 'Complete the daily task before claiming.');
        }
        const coins = (account.coins ?? 0) + (task?.coins ?? DAILY_CHECK_IN_COINS);
        if (!Number.isSafeInteger(coins)) throw new Error('Coin balance exceeds the supported limit.');
        const dailyRewards = { ...state,
          checkInDays: reward === 'check-in' ? [...state.checkInDays, day] : state.checkInDays,
          claimedTasks: reward === 'check-in' ? state.claimedTasks : [...state.claimedTasks, reward],
        };
        const updated: AccountRecord = { ...account, dailyRewards, coins,
          achievements: reward === 'check-in' ? account.achievements : {
            ...achievementState(account.achievements), dailyTasks: (account.achievements?.dailyTasks ?? 0) + 1,
          },
          coinRevision: (account.coinRevision ?? 0) + 1, updatedAt: Math.max(timestamp, account.updatedAt + 1) };
        data.accounts[index] = updated;
        return { account: updated, dailyRewards: dailyStatus(dailyRewards, timestamp, id) };
      }),
      replaceDailyTask: (id, task, day) => write(['accounts'], (data) => {
        const index = indexes.accounts(document.accounts).positions.get(id);
        if (index === undefined) return null;
        const account = data.accounts[index];
        const timestamp = now();
        const state = dailyState(account.dailyRewards, timestamp, id);
        if (day !== state.day) throw repositoryError('DAILY_DATE_CHANGED', 'Refresh today’s rewards.');
        if (state.replacement?.from === task) return { account, dailyRewards: dailyStatus(state, timestamp, id) };
        if (state.replacement) throw repositoryError('DAILY_REPLACE_USED', 'Today’s replacement has been used.');
        if (!state.taskIds.includes(task) || state.claimedTasks.includes(task)) {
          throw repositoryError('DAILY_TASK_UNAVAILABLE', 'Choose an assigned, unclaimed task.');
        }
        const to = replacementTask(state, id);
        const dailyRewards = { ...state, taskIds: state.taskIds.map((entry) => entry === task ? to : entry), replacement: { from: task, to } };
        const updated: AccountRecord = { ...account, dailyRewards, updatedAt: Math.max(timestamp, account.updatedAt + 1) };
        data.accounts[index] = updated;
        return { account: updated, dailyRewards: dailyStatus(dailyRewards, timestamp, id) };
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
        saveMatches(matches, (data) => {
          data.runtime = structuredClone(snapshot);
          awardGameCoins(data, snapshot, completedGameIds);
          recordLastSeen(data, snapshot);
        }),
      saveMatch: (match) => saveMatches([match], () => undefined),
      listMatches: (accountId, limit) =>
        read((data) => {
          const matches = (indexes.matches(data.matches).byAccount.get(accountId) ?? [])
            .filter((match) => !match.accountIds.some((id) => id.startsWith('bot:')));
          return limit === undefined ? matches : matches.slice(0, boundedLimit(limit, 100));
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
        activePaths.delete(pathKey);
      },
    };
  } catch (error) {
    activePaths.delete(pathKey);
    throw error;
  }
}
