import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { isAvatarBorderId, MAX_EMOJIS_PER_ACCOUNT } from '@shared/constants';
import { isReplayRecordId } from '@shared/replay-session';
import type { MatchReplay, ShopItemId } from '@shared/types';
import type { RuntimeSnapshot } from '../runtime/types';
import { isRuntimeSnapshot } from '../runtime/validate';
import {
  achievementClaim, completedGame, dailyRewardClaim, dailyTaskReplacement, gameRewardedAccount, observedLastSeen,
  profileUpdatedAccount, purchasedAccount, rewardedHumans,
} from './account-operations';
import { achievementsStatus } from './achievements';
import { dailyStatus } from './daily-rewards';
import { friendshipPair } from './indexes';
import { dropUnplayableRecordings, isMatchReplay } from './match-replay';
import { retainMatches } from './match-retention';
import type { DatabaseLock } from './owner-lock';
import { acquireDatabaseLock } from './owner-lock';
import { createReplayStore } from './replay-store';
import type { AccountRecord, DirectMessageRecord, MatchRecord, NewMatchRecord, Repository, RepositoryOptions } from './repository';
import { MAX_MATCHES_PER_ACCOUNT, publicAccount, repositoryError, SOCIAL_HISTORY_RETENTION_MS } from './repository';
import {
  botId, isObject, validDirectMessage, validEmoji, validFriendNotification, validFriendship, validMatch, validMessageRead, validSession,
  validateDocument,
} from './schema';
import { claimSqlitePath, copySqliteDatabase, inTransaction, openSqliteDatabase } from './sqlite-schema';
import type { RuntimeRows, Statements } from './sqlite-store';
import {
  accountFromRow, advanceLastSeen, createStatements, directMessageFromRow, emojiFromRow, friendNotificationFromRow,
  friendshipFromRow, hasAccount, insertAccount, insertDirectMessage, insertEmoji, insertFriendNotification,
  insertFriendship, insertMessageRead, insertSession, integerColumn, invalidReferencesError, invalidSchemaError, isBotId, matchFromRow,
  messageReadFromRow, parseRuntime, readAccount, readAccountByUsername, readDocument, readRuntimeRows,
  runtimeReferencesValid, serializeRuntime, sessionFromRow, textColumn, updateAccount, upsertMatchRow, writeRuntimeRows,
} from './sqlite-store';
import { backupMatchHistoryState } from './state-backup';
import { storedMatches } from './stored-matches';

function boundedLimit(limit: number, maximum: number): number {
  return Math.trunc(Math.min(Math.max(limit, 0), maximum)) || 0;
}

/**
 * Validates and applies match upserts, then prunes history like `retainMatches`, re-ranking only
 * accounts whose history changed. Returns flagged archives the commit no longer references.
 */
function upsertMatches(sql: Statements, matches: readonly MatchRecord[]): string[] {
  if (matches.length === 0) return [];
  const touched = new Set<string>();
  const watched = new Set<string>();
  for (const match of matches) {
    if (!validMatch(match)) throw invalidSchemaError();
    if (!match.accountIds.some((id) => hasAccount(sql, id)) ||
      !match.accountIds.every((id) => hasAccount(sql, id) || botId(id))) throw invalidReferencesError();
    const existing = sql('SELECT seq, has_replay FROM matches WHERE id = ?').get(match.id);
    if (existing) {
      if (existing.has_replay === 1) watched.add(match.id);
      for (const row of sql('SELECT account_id FROM match_participants WHERE match_seq = ?').all(integerColumn(existing, 'seq'))) {
        touched.add(textColumn(row, 'account_id'));
      }
    }
    upsertMatchRow(sql, match);
    for (const id of match.accountIds) touched.add(id);
    if (match.hasReplay) watched.add(match.id);
  }
  // Decide every removal before deleting, so ranks count the same rows as the whole-history rule.
  const candidates = new Map<number, { id: string; finishedAt: number; hasReplay: boolean }>();
  for (const accountId of touched) {
    if (isBotId(accountId)) continue;
    for (const row of sql(`SELECT m.seq, m.id, m.finished_at, m.has_replay FROM match_participants p
      JOIN matches m ON m.seq = p.match_seq WHERE p.account_id = ?
      ORDER BY p.finished_at DESC, p.match_seq ASC LIMIT -1 OFFSET ?`).all(accountId, MAX_MATCHES_PER_ACCOUNT)) {
      candidates.set(integerColumn(row, 'seq'), { id: textColumn(row, 'id'), finishedAt: integerColumn(row, 'finished_at'),
        hasReplay: row.has_replay === 1 });
    }
  }
  const pruned: number[] = [];
  for (const [seq, candidate] of candidates) {
    const retained = sql('SELECT account_id FROM match_participants WHERE match_seq = ?').all(seq).some((row) => {
      const accountId = textColumn(row, 'account_id');
      if (isBotId(accountId)) return false;
      const newer = sql(`SELECT COUNT(*) AS count FROM match_participants WHERE account_id = ?
        AND (finished_at > ? OR (finished_at = ? AND match_seq < ?))`)
        .get(accountId, candidate.finishedAt, candidate.finishedAt, seq);
      return newer !== undefined && integerColumn(newer, 'count') < MAX_MATCHES_PER_ACCOUNT;
    });
    if (retained) continue;
    pruned.push(seq);
    if (candidate.hasReplay) watched.add(candidate.id);
  }
  for (const seq of pruned) sql('DELETE FROM matches WHERE seq = ?').run(seq);
  return [...watched].filter((id) => sql('SELECT has_replay FROM matches WHERE id = ?').get(id)?.has_replay !== 1);
}

/** A single server process owns the database file, enforced across processes by its lock file. */
export async function createSqliteRepository(filePath: string, options: RepositoryOptions = {}): Promise<Repository> {
  const now = options.now ?? Date.now;
  const path = resolve(filePath);
  const release = claimSqlitePath(path);
  let lock: DatabaseLock | undefined;
  let database: DatabaseSync | undefined;
  try {
    await mkdir(dirname(path), { recursive: true });
    lock = await acquireDatabaseLock(path);
    const ownerLock: DatabaseLock = lock;
    ({ database } = await openSqliteDatabase(path));
    const db: DatabaseSync = database;
    const sql = createStatements(db);
    const replayDirectory = options.replayDirectory ?? join(dirname(path), 'replays');
    const replays = createReplayStore(replayDirectory);
    /** Matches whose unavailable archive was already reported. */
    const reportedReplays = new Set<string>();
    let queue: Promise<void> = Promise.resolve();
    let closed = false;
    /** Reads queued before close still complete; only the closed connection refuses them. */
    let disconnected = false;

    // Startup applies the same whole-document checks as the JSON adapter; writes check only their records.
    const document = readDocument(sql);
    const unplayable = dropUnplayableRecordings(document);
    for (const gameId of unplayable) {
      console.warn(`[database] Dropped an unplayable replay recording; game ${gameId} continues unrecorded.`);
    }
    validateDocument(document);
    if (unplayable.length > 0 && document.runtime) {
      const runtime = document.runtime;
      inTransaction(db, () => writeRuntimeRows(sql, serializeRuntime(runtime), readRuntimeRows(sql)));
    }
    const retained = new Set(retainMatches(document.matches).map((match) => match.id));
    if (retained.size !== document.matches.length) {
      await backupMatchHistoryState(path, (backupPath) => copySqliteDatabase(db, join(backupPath, basename(path))),
        options.replayDirectory);
      inTransaction(db, () => {
        for (const match of document.matches) {
          if (!retained.has(match.id)) sql('DELETE FROM matches WHERE id = ?').run(match.id);
        }
      });
    }
    const flagged = new Set(document.matches.flatMap((match) => match.hasReplay && retained.has(match.id) ? [match.id] : []));
    // Archives written before a failed commit or left by a crash have no flagged match.
    const unavailable = await replays.sweep(flagged);
    for (const matchId of unavailable) reportedReplays.add(matchId);
    if (unavailable.length > 0) {
      console.warn(`[replays] ${unavailable.length} recorded matches have no archive file; they show no replay.`);
    }
    /** The committed runtime rows; only rows that differ from these are written. */
    let committedRuntime: RuntimeRows | null = readRuntimeRows(sql);

    async function read<T>(select: () => T): Promise<T> {
      await queue;
      if (disconnected) throw new Error('Repository is closed.');
      return select();
    }

    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(new Error('Repository is closed.'));
      const result = queue.then(operation);
      queue = result.then(() => undefined, () => undefined);
      return result;
    }

    /** One serialized transaction; results are detached from anything the caller passed in. */
    function write<T>(update: () => T): Promise<T> {
      return enqueue(async () => structuredClone(inTransaction(db, update)));
    }

    function accountForUpdate(id: string): AccountRecord | null {
      return readAccount(sql, id);
    }

    function flaggedIds(ids: readonly string[]): Set<string> {
      return new Set(ids.filter((id) => sql('SELECT has_replay FROM matches WHERE id = ?').get(id)?.has_replay === 1));
    }

    /**
     * Serializes and validates a runtime snapshot. Games whose row is unchanged were validated when
     * they were committed, so only their links to players and rooms are checked again; account
     * references are checked only for rows that changed.
     */
    function stageRuntime(snapshot: RuntimeSnapshot): RuntimeRows {
      let next: RuntimeRows;
      try {
        next = serializeRuntime(snapshot);
      } catch {
        throw invalidSchemaError();
      }
      const previous = committedRuntime;
      const validatedGame = (game: unknown): boolean => isObject(game) && typeof game.roomCode === 'string'
        && previous !== null && previous.games.get(game.roomCode) === next.games.get(game.roomCode);
      if (!isRuntimeSnapshot(snapshot, { applyReplaySteps: false, validatedGame })) throw invalidSchemaError();
      // Accounts are never deleted, so unchanged rows keep the references they were checked with.
      const changed = <T>(name: 'players' | 'games' | 'chat', key: string, value: T): T[] =>
        previous?.[name].get(key) === next[name].get(key) ? [] : [value];
      const known = new Map<string, boolean>();
      const exists = (id: string): boolean => {
        let found = known.get(id);
        if (found === undefined) {
          found = hasAccount(sql, id);
          known.set(id, found);
        }
        return found;
      };
      if (!runtimeReferencesValid(exists,
        snapshot.players.flatMap((player) => changed('players', player.info.id, player)),
        snapshot.games.flatMap((game) => changed('games', game.roomCode, game)),
        snapshot.chat.flatMap((entry) => changed('chat', entry.roomCode, entry.messages)))) {
        throw invalidReferencesError();
      }
      return next;
    }

    function awardGameCoins(snapshot: RuntimeSnapshot, completedGameIds: readonly string[]): void {
      const rewardedAt = now();
      for (const id of completedGameIds) {
        if (sql('SELECT 1 FROM rewarded_games WHERE game_id = ?').get(id)) continue;
        const game = completedGame(snapshot.games, id);
        for (const accountId of rewardedHumans(game)) {
          const account = accountForUpdate(accountId);
          if (!account) throw new Error('Coin reward account does not exist.');
          updateAccount(sql, gameRewardedAccount(account, game, rewardedAt));
        }
        sql('INSERT INTO rewarded_games (game_id) VALUES (?)').run(id);
      }
    }

    function recordLastSeen(snapshot: RuntimeSnapshot): void {
      const timestamp = now();
      for (const player of snapshot.players) {
        const lastSeenAt = observedLastSeen(player, timestamp);
        if (lastSeenAt !== null) advanceLastSeen(sql, player.info.id, lastSeenAt);
      }
    }

    /**
     * Archives are written before the commit that flags their matches, and archives the commit
     * unflags are deleted only after it succeeds, so a flag never points to a file deleted early.
     */
    function saveMatches(matches: readonly NewMatchRecord[], snapshot?: RuntimeSnapshot, completedGameIds: readonly string[] = []): Promise<void> {
      return enqueue(async () => {
        const { records, archives } = storedMatches(matches);
        const written: string[] = [];
        let unflagged: string[];
        try {
          for (const [matchId, replay] of archives) {
            await replays.write(matchId, replay);
            written.push(matchId);
          }
          let runtime: RuntimeRows | undefined;
          // The same order as the JSON adapter, so a request with several problems reports the same one.
          unflagged = inTransaction(db, () => {
            if (snapshot) {
              awardGameCoins(snapshot, completedGameIds);
              recordLastSeen(snapshot);
            }
            const removed = upsertMatches(sql, records);
            if (snapshot) {
              runtime = stageRuntime(snapshot);
              writeRuntimeRows(sql, runtime, committedRuntime);
            }
            return removed;
          });
          if (runtime) committedRuntime = runtime;
        } catch (error) {
          // Keep files that a committed match still flags; startup sweeps anything left.
          const committed = flaggedIds(written);
          await replays.remove(written.filter((matchId) => !committed.has(matchId)));
          throw error;
        }
        await replays.remove(unflagged);
      });
    }

    function purchaseShopItem(id: string, itemId: ShopItemId, timestamp: number): Promise<AccountRecord | null> {
      return write(() => {
        const account = accountForUpdate(id);
        if (!account) return null;
        const updated = purchasedAccount(account, itemId, timestamp);
        if (updated !== account) updateAccount(sql, updated);
        return updated;
      });
    }

    function messageCutoff(): number {
      return now() - SOCIAL_HISTORY_RETENTION_MS;
    }

    return {
      getAccountById: (id) => read(() => readAccount(sql, id)),
      getAccountByUsername: (usernameNormalized) => read(() => readAccountByUsername(sql, usernameNormalized)),
      searchAccounts: (query, excludeId, limit = 20) => read(() => {
        const count = boundedLimit(limit, 50);
        if (count === 0) return [];
        const normalizedQuery = query.toLowerCase();
        return sql(`SELECT a.record, act.last_seen_at FROM accounts a LEFT JOIN account_activity act ON act.account_id = a.id
          WHERE a.id != ? AND (instr(a.username_normalized, ?) > 0 OR instr(a.nickname_search, ?) > 0)
          ORDER BY a.seq LIMIT ?`).all(excludeId, normalizedQuery, normalizedQuery, count).map((row) => publicAccount(accountFromRow(row)));
      }),
      createAccount: (account) => write(() => {
        if (sql('SELECT 1 FROM accounts WHERE id = ? OR username_normalized = ?').get(account.id, account.usernameNormalized)) {
          throw repositoryError('USERNAME_EXISTS', 'Username is already taken.');
        }
        insertAccount(sql, account);
        return account;
      }),
      updateProfile: (id, profile, timestamp) => write(() => {
        const account = accountForUpdate(id);
        if (!account) return null;
        const updated = profileUpdatedAccount(account, profile, timestamp);
        updateAccount(sql, updated);
        return updated;
      }),
      purchaseAvatarBorder: (id, border, timestamp) => {
        if (!isAvatarBorderId(border)) return Promise.reject(repositoryError('INVALID_BORDER', 'Choose an available avatar border.'));
        return purchaseShopItem(id, border, timestamp);
      },
      purchaseShopItem,
      getAchievements: (id) => read(() => {
        const account = readAccount(sql, id);
        return account ? achievementsStatus(account) : null;
      }),
      claimAchievement: (id, categoryId) => write(() => {
        const account = accountForUpdate(id);
        if (!account) return null;
        const claimed = achievementClaim(account, categoryId, now());
        if (claimed.account !== account) updateAccount(sql, claimed.account);
        return claimed;
      }),
      getDailyRewards: (id) => read(() => {
        const account = readAccount(sql, id);
        return account ? dailyStatus(account.dailyRewards, now(), id) : null;
      }),
      claimDailyReward: (id, reward, day) => write(() => {
        const account = accountForUpdate(id);
        if (!account) return null;
        const claimed = dailyRewardClaim(account, reward, day, now());
        if (claimed.account !== account) updateAccount(sql, claimed.account);
        return claimed;
      }),
      replaceDailyTask: (id, task, day) => write(() => {
        const account = accountForUpdate(id);
        if (!account) return null;
        const replaced = dailyTaskReplacement(account, task, day, now());
        if (replaced.account !== account) updateAccount(sql, replaced.account);
        return replaced;
      }),
      changePassword: (id, expectedHash, passwordHash, timestamp) => write(() => {
        const account = accountForUpdate(id);
        // The compare-and-swap condition is re-checked by the UPDATE itself.
        if (!account || account.passwordHash !== expectedHash) return false;
        updateAccount(sql, { ...account, passwordHash, updatedAt: timestamp });
        sql('DELETE FROM sessions WHERE account_id = ?').run(id);
        return true;
      }),
      createSession: (session, expectedPasswordHash) => write(() => {
        const row = sql('SELECT password_hash FROM accounts WHERE id = ?').get(session.accountId);
        if (row?.password_hash !== expectedPasswordHash) return false;
        if (!validSession(session)) throw invalidSchemaError();
        sql('DELETE FROM sessions WHERE expires_at <= ?').run(session.createdAt);
        insertSession(sql, session);
        return true;
      }),
      getSession: (hash) => read(() => {
        const row = sql('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
        return row ? sessionFromRow(row) : null;
      }),
      deleteSession: (hash) => write(() => {
        sql('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      }),
      deleteAccountSessions: (accountId) => write(() => {
        sql('DELETE FROM sessions WHERE account_id = ?').run(accountId);
      }),
      listFriendships: (accountId) => read(() =>
        sql('SELECT * FROM friendships WHERE requester_id = ? OR recipient_id = ? ORDER BY seq')
          .all(accountId, accountId).map(friendshipFromRow)),
      getFriendship: (id) => read(() => {
        const row = sql('SELECT * FROM friendships WHERE id = ?').get(id);
        return row ? friendshipFromRow(row) : null;
      }),
      createFriendship: (friendship) => write(() => {
        const { requesterId, recipientId } = friendship;
        if (requesterId === recipientId || !hasAccount(sql, requesterId) || !hasAccount(sql, recipientId)) {
          throw repositoryError('INVALID_FRIENDSHIP', 'Invalid friend request.');
        }
        if (sql('SELECT 1 FROM friendships WHERE pair = ?').get(friendshipPair(requesterId, recipientId))) {
          throw repositoryError('FRIENDSHIP_EXISTS', 'A friendship or request already exists.');
        }
        if (!validFriendship(friendship)) throw invalidSchemaError();
        if (sql('SELECT 1 FROM friendships WHERE id = ?').get(friendship.id)) throw invalidReferencesError();
        insertFriendship(sql, friendship);
        return friendship;
      }),
      acceptFriendship: (id, recipientId) => write(() => {
        const row = sql('SELECT * FROM friendships WHERE id = ?').get(id);
        const current = row && friendshipFromRow(row);
        if (!current || current.recipientId !== recipientId || current.status !== 'pending') return null;
        const friendship = { ...current, status: 'accepted' as const, updatedAt: now() };
        if (!validFriendship(friendship)) throw invalidSchemaError();
        const notification = { id: randomUUID(), accountId: friendship.requesterId, actorId: recipientId,
          createdAt: friendship.updatedAt };
        if (!validFriendNotification(notification)) throw invalidSchemaError();
        sql("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE id = ?").run(friendship.updatedAt, id);
        insertFriendNotification(sql, notification);
        return friendship;
      }),
      deleteFriendship: (id, accountId, expectedStatus) => write(() => {
        const row = sql('SELECT * FROM friendships WHERE id = ?').get(id);
        if (!row) return false;
        const friendship = friendshipFromRow(row);
        if ((friendship.requesterId !== accountId && friendship.recipientId !== accountId) ||
          (expectedStatus !== undefined && friendship.status !== expectedStatus)) return false;
        sql('DELETE FROM friendships WHERE id = ?').run(id);
        return true;
      }),
      listDirectMessages: (accountId, otherId) => read(() => {
        const cutoff = messageCutoff();
        const rows = otherId === undefined
          ? sql(`SELECT record FROM direct_messages WHERE seq IN (
              SELECT seq FROM direct_messages WHERE sender_id = ? AND timestamp > ?
              UNION ALL SELECT seq FROM direct_messages WHERE recipient_id = ? AND timestamp > ?)
            ORDER BY timestamp, seq`).all(accountId, cutoff, accountId, cutoff)
          : sql('SELECT record FROM direct_messages WHERE pair = ? AND timestamp > ? ORDER BY timestamp, seq')
            .all(friendshipPair(accountId, otherId), cutoff);
        return rows.map(directMessageFromRow);
      }),
      createDirectMessage: (input) => {
        // Stored records hold only defined JSON fields; normalize the request the same way.
        const message = JSON.parse(JSON.stringify(input)) as DirectMessageRecord;
        return write(() => {
          if (!validDirectMessage(message)) throw repositoryError('INVALID_MESSAGE', 'Invalid direct message.');
          const row = sql('SELECT record FROM direct_messages WHERE sender_id = ? AND client_id = ?').get(message.senderId, message.clientId);
          if (row) {
            const existing = directMessageFromRow(row);
            const { id: _existingId, timestamp: _existingTimestamp, ...previous } = existing;
            const { id: _requestedId, timestamp: _requestedTimestamp, ...requested } = message;
            if (!isDeepStrictEqual(previous, requested)) {
              throw repositoryError('MESSAGE_CONFLICT', 'This message request was already used for different content.');
            }
            if (existing.timestamp <= messageCutoff()) {
              throw repositoryError('MESSAGE_EXPIRED', 'This message has expired. Send a new message.');
            }
            return existing;
          }
          if (sql('SELECT 1 FROM direct_messages WHERE id = ?').get(message.id) || message.timestamp > now() ||
            message.timestamp <= messageCutoff()) {
            throw repositoryError('INVALID_MESSAGE', 'Invalid direct message.');
          }
          if (!sql("SELECT 1 FROM friendships WHERE pair = ? AND status = 'accepted'").get(friendshipPair(message.senderId, message.recipientId))) {
            throw repositoryError('NOT_FRIENDS', 'You can only send messages to friends.');
          }
          insertDirectMessage(sql, message);
          return message;
        });
      },
      listMessageReads: (accountId) => read(() =>
        sql(`SELECT r.* FROM message_reads r JOIN direct_messages m ON m.id = r.message_id
          WHERE r.account_id = ? AND m.timestamp > ? ORDER BY r.seq`).all(accountId, messageCutoff()).map(messageReadFromRow)),
      markDirectMessagesRead: (accountId, otherId, messageId) => write(() => {
        const message = sql('SELECT seq, sender_id, recipient_id, timestamp FROM direct_messages WHERE id = ?').get(messageId);
        if (!message || message.sender_id !== otherId || message.recipient_id !== accountId ||
          integerColumn(message, 'timestamp') <= messageCutoff()) {
          throw repositoryError('INVALID_MESSAGE_READ', 'Choose a retained message received from this friend.');
        }
        const cursor = sql(`SELECT r.seq, m.timestamp, m.seq AS message_seq FROM message_reads r
          JOIN direct_messages m ON m.id = r.message_id WHERE r.account_id = ? AND r.other_id = ?`).get(accountId, otherId);
        if (!cursor) {
          const read = { accountId, otherId, messageId };
          if (!validMessageRead(read)) throw invalidSchemaError();
          insertMessageRead(sql, read);
          return;
        }
        // Chronological order: timestamp, then insertion order for equal timestamps.
        const timestamp = integerColumn(message, 'timestamp');
        const previous = integerColumn(cursor, 'timestamp');
        if (timestamp > previous || (timestamp === previous && integerColumn(message, 'seq') > integerColumn(cursor, 'message_seq'))) {
          sql('UPDATE message_reads SET message_id = ? WHERE seq = ?').run(messageId, integerColumn(cursor, 'seq'));
        }
      }),
      listFriendNotifications: (accountId) => read(() =>
        sql('SELECT * FROM friend_notifications WHERE account_id = ? AND created_at > ? ORDER BY created_at DESC, seq ASC')
          .all(accountId, messageCutoff()).map(friendNotificationFromRow)),
      markFriendNotificationsRead: (accountId, ids) => write(() => {
        const readAt = now();
        if (ids === 'all') {
          sql('UPDATE friend_notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL').run(readAt, accountId);
          sql(`UPDATE friendships SET recipient_read_at = ? WHERE recipient_id = ? AND status = 'pending'
            AND recipient_read_at IS NULL`).run(readAt, accountId);
          return;
        }
        for (const id of new Set(ids)) {
          sql('UPDATE friend_notifications SET read_at = ? WHERE account_id = ? AND id = ? AND read_at IS NULL')
            .run(readAt, accountId, id);
          sql(`UPDATE friendships SET recipient_read_at = ? WHERE recipient_id = ? AND id = ? AND status = 'pending'
            AND recipient_read_at IS NULL`).run(readAt, accountId, id);
        }
      }),
      dismissFriendNotifications: (accountId, ids) => write(() => {
        for (const id of new Set(ids)) sql('DELETE FROM friend_notifications WHERE account_id = ? AND id = ?').run(accountId, id);
      }),
      clearReadFriendNotifications: (accountId) => write(() =>
        Number(sql('DELETE FROM friend_notifications WHERE account_id = ? AND read_at IS NOT NULL').run(accountId).changes)),
      recordAccountActivity: (accountId, at) => write(() => {
        if (!Number.isSafeInteger(at) || at < 0) throw new Error('Invalid activity time.');
        advanceLastSeen(sql, accountId, at);
      }),
      pruneSocialHistory: (time) => write(() => {
        if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid social history pruning time.');
        const cutoff = time - SOCIAL_HISTORY_RETENTION_MS;
        // Read cursors of removed messages cascade with them.
        sql('DELETE FROM direct_messages WHERE timestamp <= ?').run(cutoff);
        sql('DELETE FROM friend_notifications WHERE created_at <= ?').run(cutoff);
      }),
      loadRuntime: () => read(() => {
        const rows = readRuntimeRows(sql);
        return rows && parseRuntime(rows);
      }),
      saveRuntime: (snapshot, matches = [], completedGameIds = []) => saveMatches(matches, snapshot, completedGameIds),
      saveMatch: (match) => saveMatches([match]),
      listMatches: (accountId, limit) => read(() => {
        const count = limit === undefined ? MAX_MATCHES_PER_ACCOUNT : boundedLimit(limit, MAX_MATCHES_PER_ACCOUNT);
        if (count === 0) return [];
        return sql(`SELECT m.record FROM match_participants p JOIN matches m ON m.seq = p.match_seq
          WHERE p.account_id = ? ORDER BY p.finished_at DESC, p.match_seq ASC LIMIT ?`).all(accountId, count).map(matchFromRow);
      }),
      getMatchReplay: async (matchId) => {
        if (!isReplayRecordId(matchId)) return undefined;
        const flaggedMatch = (): Promise<MatchRecord | undefined> => read(() => {
          const row = sql('SELECT record FROM matches WHERE id = ? AND has_replay = 1').get(matchId);
          return row ? matchFromRow(row) : undefined;
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
      listEmojis: (accountId) => read(() =>
        sql('SELECT * FROM emojis WHERE account_id = ? ORDER BY seq').all(accountId).map(emojiFromRow)),
      createEmojis: (accountId, items, timestamp) => write(() => {
        const names = new Set(sql('SELECT name FROM emojis WHERE account_id = ?').all(accountId).map((row) => textColumn(row, 'name')));
        if (names.size + items.length > MAX_EMOJIS_PER_ACCOUNT) throw repositoryError('EMOJI_LIMIT', 'Emoji library is full.');
        const created = items.map(({ name, mediaId }) => {
          if (names.has(name)) throw repositoryError('EMOJI_EXISTS', `Emoji :${name}: already exists.`);
          names.add(name);
          return { id: randomUUID(), accountId, name, mediaId, createdAt: timestamp };
        });
        if (!created.every(validEmoji)) throw invalidSchemaError();
        if (!hasAccount(sql, accountId)) throw invalidReferencesError();
        for (const emoji of created) insertEmoji(sql, emoji);
        return created;
      }),
      deleteEmoji: (accountId, id) => write(() =>
        sql('DELETE FROM emojis WHERE id = ? AND account_id = ?').run(id, accountId).changes > 0),
      deleteEmojis: (accountId, ids) => write(() => {
        const requested = new Set(ids);
        const deleted = sql('SELECT id FROM emojis WHERE account_id = ? ORDER BY seq').all(accountId)
          .map((row) => textColumn(row, 'id')).filter((id) => requested.has(id));
        for (const id of deleted) sql('DELETE FROM emojis WHERE id = ?').run(id);
        return deleted;
      }),
      renameEmoji: (accountId, id, name) => write(() => {
        const row = sql('SELECT * FROM emojis WHERE id = ? AND account_id = ?').get(id, accountId);
        if (!row) return null;
        if (sql('SELECT 1 FROM emojis WHERE account_id = ? AND name = ? AND id != ?').get(accountId, name, id)) {
          throw repositoryError('EMOJI_EXISTS', `Emoji :${name}: already exists.`);
        }
        const emoji = { ...emojiFromRow(row), name };
        if (!validEmoji(emoji)) throw invalidSchemaError();
        sql('UPDATE emojis SET name = ? WHERE id = ?').run(name, id);
        return emoji;
      }),
      close: async () => {
        if (closed) {
          await queue;
          return;
        }
        closed = true;
        await queue;
        disconnected = true;
        db.close();
        await ownerLock.release();
        release();
      },
    };
  } catch (error) {
    database?.close();
    // The startup error matters more; a lock left behind is replaced once this process ends.
    await lock?.release().catch(() => undefined);
    release();
    throw error;
  }
}
