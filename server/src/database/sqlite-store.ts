import type { DatabaseSync, SQLInputValue, SQLOutputValue, StatementSync } from 'node:sqlite';
import type { AnyGameState, ChatMessage } from '@shared/types';
import type { PersistedPlayer, PersistedRoom, RuntimeSnapshot } from '../runtime/types';
import { CURRENT_SCHEMA_VERSION } from './migrations';
import type {
  AccountRecord, DirectMessageRecord, EmojiRecord, FriendNotificationRecord, FriendshipRecord, MatchRecord,
  MessageReadRecord, SessionRecord,
} from './repository';
import type { DatabaseDocument } from './schema';
import { botId, validAccount } from './schema';
import type { AccountStatsRecord, GameStatsRecord, StatsBackfillState, StatsSource } from './game-stats';
import { validAccountStats, validGameStats } from './game-stats';
import { friendshipPair } from './indexes';

export type Row = Record<string, SQLOutputValue>;

/** Same wording as full-document validation, so both engines reject a write identically. */
export function invalidSchemaError(): Error {
  return new Error('Invalid or unsupported database schema. Restore a valid backup; the original file was preserved.');
}

export function invalidReferencesError(): Error {
  return new Error('Database has invalid references or duplicate records. The original file was preserved.');
}

export function textColumn(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`SQLite column ${column} is not text.`);
  return value;
}

export function integerColumn(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`SQLite column ${column} is not an integer.`);
  return value;
}

/** Stored JSON was validated before it was written and again by the startup check. */
export function parseStored<T>(text: string): T {
  return JSON.parse(text) as T;
}

export type Statements = (sql: string) => StatementSync;

/** Prepares each SQL text once per connection. */
export function createStatements(database: DatabaseSync): Statements {
  const cache = new Map<string, StatementSync>();
  return (sql) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = database.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
}

export function isBotId(id: string): boolean {
  return id.startsWith('bot:');
}

// Accounts: `last_seen_at` lives in a narrow table so runtime commits do not rewrite account records.

const ACCOUNT_SELECT = 'SELECT a.record, act.last_seen_at FROM accounts a LEFT JOIN account_activity act ON act.account_id = a.id';

export function accountFromRow(row: Row): AccountRecord {
  const account = parseStored<AccountRecord>(textColumn(row, 'record'));
  const lastSeenAt = row.last_seen_at;
  return lastSeenAt === null || lastSeenAt === undefined ? account : { ...account, lastSeenAt: integerColumn(row, 'last_seen_at') };
}

export function readAccount(sql: Statements, id: string): AccountRecord | null {
  const row = sql(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(id);
  return row ? accountFromRow(row) : null;
}

export function readAccountByUsername(sql: Statements, usernameNormalized: string): AccountRecord | null {
  const row = sql(`${ACCOUNT_SELECT} WHERE a.username_normalized = ?`).get(usernameNormalized);
  return row ? accountFromRow(row) : null;
}

export function hasAccount(sql: Statements, id: string): boolean {
  return sql('SELECT 1 FROM accounts WHERE id = ?').get(id) !== undefined;
}

function accountColumns(account: AccountRecord): SQLInputValue[] {
  const { lastSeenAt: _lastSeenAt, ...record } = account;
  return [account.usernameNormalized, account.nickname.toLowerCase(), account.passwordHash, JSON.stringify(record)];
}

export function insertAccount(sql: Statements, account: AccountRecord): void {
  if (!validAccount(account)) throw invalidSchemaError();
  sql('INSERT INTO accounts (id, username_normalized, nickname_search, password_hash, record) VALUES (?, ?, ?, ?, ?)')
    .run(account.id, ...accountColumns(account));
  if (account.lastSeenAt !== undefined) {
    sql('INSERT INTO account_activity (account_id, last_seen_at) VALUES (?, ?)').run(account.id, account.lastSeenAt);
  }
}

/** Replaces an existing account's record; last-seen history changes only through `advanceLastSeen`. */
export function updateAccount(sql: Statements, account: AccountRecord): void {
  if (!validAccount(account)) throw invalidSchemaError();
  const { changes } = sql('UPDATE accounts SET username_normalized = ?, nickname_search = ?, password_hash = ?, record = ? WHERE id = ?')
    .run(...accountColumns(account), account.id);
  if (changes !== 1) throw new Error('Account does not exist.');
}

/** Never moves history backwards; ignores IDs without an account. */
export function advanceLastSeen(sql: Statements, accountId: string, lastSeenAt: number): void {
  sql(`INSERT INTO account_activity (account_id, last_seen_at) SELECT id, ? FROM accounts WHERE id = ?
    ON CONFLICT (account_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    WHERE excluded.last_seen_at > account_activity.last_seen_at`).run(lastSeenAt, accountId);
}

// Other records.

export function sessionFromRow(row: Row): SessionRecord {
  return { tokenHash: textColumn(row, 'token_hash'), accountId: textColumn(row, 'account_id'),
    createdAt: integerColumn(row, 'created_at'), expiresAt: integerColumn(row, 'expires_at') };
}

export function insertSession(sql: Statements, session: SessionRecord): void {
  sql('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(session.tokenHash, session.accountId, session.createdAt, session.expiresAt);
}

export function friendshipFromRow(row: Row): FriendshipRecord {
  const status = textColumn(row, 'status');
  if (status !== 'pending' && status !== 'accepted') throw new Error('SQLite friendship status is invalid.');
  const record: FriendshipRecord = { id: textColumn(row, 'id'), requesterId: textColumn(row, 'requester_id'),
    recipientId: textColumn(row, 'recipient_id'), status, createdAt: integerColumn(row, 'created_at'),
    updatedAt: integerColumn(row, 'updated_at') };
  return row.recipient_read_at === null || row.recipient_read_at === undefined ? record
    : { ...record, recipientReadAt: integerColumn(row, 'recipient_read_at') };
}

export function insertFriendship(sql: Statements, friendship: FriendshipRecord): void {
  sql(`INSERT INTO friendships (id, requester_id, recipient_id, pair, status, created_at, updated_at, recipient_read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(friendship.id, friendship.requesterId, friendship.recipientId,
    friendshipPair(friendship.requesterId, friendship.recipientId), friendship.status, friendship.createdAt, friendship.updatedAt,
    friendship.recipientReadAt ?? null);
}

export function matchFromRow(row: Row): MatchRecord {
  return parseStored<MatchRecord>(textColumn(row, 'record'));
}

/** Inserts or replaces a match in place; a replacement keeps its original insertion order. */
export function upsertMatchRow(sql: Statements, match: MatchRecord): number {
  const row = sql(`INSERT INTO matches (id, finished_at, has_replay, record) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET finished_at = excluded.finished_at, has_replay = excluded.has_replay, record = excluded.record
    RETURNING seq`).get(match.id, match.finishedAt, match.hasReplay ? 1 : 0, JSON.stringify(match));
  if (!row) throw new Error('SQLite did not return the match row.');
  const seq = integerColumn(row, 'seq');
  sql('DELETE FROM match_participants WHERE match_seq = ?').run(seq);
  match.accountIds.forEach((accountId, position) => {
    sql('INSERT INTO match_participants (match_seq, position, account_id, finished_at) VALUES (?, ?, ?, ?)')
      .run(seq, position, accountId, match.finishedAt);
  });
  return seq;
}

export function emojiFromRow(row: Row): EmojiRecord {
  return { id: textColumn(row, 'id'), accountId: textColumn(row, 'account_id'), name: textColumn(row, 'name'),
    mediaId: textColumn(row, 'media_id'), createdAt: integerColumn(row, 'created_at') };
}

export function insertEmoji(sql: Statements, emoji: EmojiRecord): void {
  sql('INSERT INTO emojis (id, account_id, name, media_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(emoji.id, emoji.accountId, emoji.name, emoji.mediaId, emoji.createdAt);
}

export function directMessageFromRow(row: Row): DirectMessageRecord {
  return parseStored<DirectMessageRecord>(textColumn(row, 'record'));
}

export function insertDirectMessage(sql: Statements, message: DirectMessageRecord): void {
  sql(`INSERT INTO direct_messages (id, sender_id, recipient_id, client_id, pair, timestamp, record)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(message.id, message.senderId, message.recipientId, message.clientId,
    friendshipPair(message.senderId, message.recipientId), message.timestamp, JSON.stringify(message));
}

export function messageReadFromRow(row: Row): MessageReadRecord {
  return { accountId: textColumn(row, 'account_id'), otherId: textColumn(row, 'other_id'), messageId: textColumn(row, 'message_id') };
}

export function insertMessageRead(sql: Statements, cursor: MessageReadRecord): void {
  sql('INSERT INTO message_reads (account_id, other_id, message_id) VALUES (?, ?, ?)')
    .run(cursor.accountId, cursor.otherId, cursor.messageId);
}

export function friendNotificationFromRow(row: Row): FriendNotificationRecord {
  const record: FriendNotificationRecord = { id: textColumn(row, 'id'), accountId: textColumn(row, 'account_id'),
    actorId: textColumn(row, 'actor_id'), createdAt: integerColumn(row, 'created_at') };
  return row.read_at === null || row.read_at === undefined ? record : { ...record, readAt: integerColumn(row, 'read_at') };
}

export function insertFriendNotification(sql: Statements, notification: FriendNotificationRecord): void {
  sql('INSERT INTO friend_notifications (id, account_id, actor_id, created_at, read_at) VALUES (?, ?, ?, ?, ?)')
    .run(notification.id, notification.accountId, notification.actorId, notification.createdAt, notification.readAt ?? null);
}

// Statistics: key columns plus the validated JSON record.

export function gameStatsFromRow(row: Row): GameStatsRecord {
  return parseStored<GameStatsRecord>(textColumn(row, 'record'));
}

export function accountStatsFromRow(row: Row): AccountStatsRecord {
  return parseStored<AccountStatsRecord>(textColumn(row, 'record'));
}

/** Inserts or replaces in place, keeping the original insertion order. */
export function upsertGameStats(sql: Statements, record: GameStatsRecord): void {
  if (!validGameStats(record)) throw invalidSchemaError();
  sql(`INSERT INTO game_stats (account_id, game_type, scope, record) VALUES (?, ?, ?, ?)
    ON CONFLICT (account_id, game_type, scope) DO UPDATE SET record = excluded.record`)
    .run(record.accountId, record.gameType, record.scope, JSON.stringify(record));
}

export function upsertAccountStats(sql: Statements, record: AccountStatsRecord): void {
  if (!validAccountStats(record)) throw invalidSchemaError();
  sql(`INSERT INTO account_stats (account_id, scope, record) VALUES (?, ?, ?)
    ON CONFLICT (account_id, scope) DO UPDATE SET record = excluded.record`)
    .run(record.accountId, record.scope, JSON.stringify(record));
}

export function sqliteStatsSource(sql: Statements): StatsSource {
  return {
    game: (accountId, gameType, scope) => {
      const row = sql('SELECT record FROM game_stats WHERE account_id = ? AND game_type = ? AND scope = ?').get(accountId, gameType, scope);
      return row ? gameStatsFromRow(row) : null;
    },
    account: (accountId, scope) => {
      const row = sql('SELECT record FROM account_stats WHERE account_id = ? AND scope = ?').get(accountId, scope);
      return row ? accountStatsFromRow(row) : null;
    },
  };
}

export function readStatsBackfill(sql: Statements): StatsBackfillState | null {
  const row = sql('SELECT after_at, after_match_id FROM stats_backfill WHERE id = 1').get();
  if (!row) return null;
  return { after: row.after_at === null ? null : { at: integerColumn(row, 'after_at'), matchId: textColumn(row, 'after_match_id') } };
}

/** Null removes the row: the backfill is finished. */
export function writeStatsBackfill(sql: Statements, state: StatsBackfillState | null): void {
  if (!state) {
    sql('DELETE FROM stats_backfill WHERE id = 1').run();
    return;
  }
  sql(`INSERT INTO stats_backfill (id, after_at, after_match_id) VALUES (1, ?, ?)
    ON CONFLICT (id) DO UPDATE SET after_at = excluded.after_at, after_match_id = excluded.after_match_id`)
    .run(state.after?.at ?? null, state.after?.matchId ?? null);
}

// Runtime: one row per player, room, game, and room chat, plus the order of each list.

export interface RuntimeLayout {
  readonly players: readonly string[];
  readonly rooms: readonly string[];
  readonly games: readonly string[];
  readonly chat: readonly string[];
}

/** Serialized rows keyed by account ID or room code. */
export interface RuntimeRows {
  readonly layout: string;
  readonly players: ReadonlyMap<string, string>;
  readonly rooms: ReadonlyMap<string, string>;
  readonly games: ReadonlyMap<string, string>;
  readonly chat: ReadonlyMap<string, string>;
}

type RuntimeTable = 'runtime_players' | 'runtime_rooms' | 'runtime_games' | 'runtime_chat';

const RUNTIME_TABLES = [
  ['players', 'runtime_players', 'account_id'], ['rooms', 'runtime_rooms', 'room_code'],
  ['games', 'runtime_games', 'room_code'], ['chat', 'runtime_chat', 'room_code'],
] as const satisfies readonly (readonly [keyof RuntimeLayout, RuntimeTable, string])[];

/** Keys are unique within each list; the runtime validator rejects duplicates before a write. */
export function serializeRuntime(snapshot: RuntimeSnapshot): RuntimeRows {
  const players = new Map(snapshot.players.map((player) => [player.info.id, JSON.stringify(player)]));
  const rooms = new Map(snapshot.rooms.map((room) => [room.info.code, JSON.stringify(room)]));
  const games = new Map(snapshot.games.map((game) => [game.roomCode, JSON.stringify(game)]));
  const chat = new Map(snapshot.chat.map((entry) => [entry.roomCode, JSON.stringify(entry.messages)]));
  const layout: RuntimeLayout = { players: [...players.keys()], rooms: [...rooms.keys()], games: [...games.keys()], chat: [...chat.keys()] };
  return { layout: JSON.stringify(layout), players, rooms, games, chat };
}

export function readRuntimeRows(sql: Statements): RuntimeRows | null {
  const state = sql('SELECT layout FROM runtime_state WHERE id = 1').get();
  if (!state) return null;
  const tables = Object.fromEntries(RUNTIME_TABLES.map(([name, table, key]) => [name,
    new Map(sql(`SELECT ${key} AS key, data FROM ${table}`).all().map((row) => [textColumn(row, 'key'), textColumn(row, 'data')]))]));
  return { layout: textColumn(state, 'layout'), players: tables.players, rooms: tables.rooms, games: tables.games, chat: tables.chat };
}

export function parseRuntime(rows: RuntimeRows): RuntimeSnapshot {
  const layout = parseStored<RuntimeLayout>(rows.layout);
  function stored<T>(values: ReadonlyMap<string, string>, key: string): T {
    const value = values.get(key);
    if (value === undefined) throw new Error('SQLite runtime layout lists a missing row.');
    return parseStored<T>(value);
  }
  return {
    players: layout.players.map((key) => stored<PersistedPlayer>(rows.players, key)),
    rooms: layout.rooms.map((key) => stored<PersistedRoom>(rows.rooms, key)),
    games: layout.games.map((key) => stored<AnyGameState>(rows.games, key)),
    chat: layout.chat.map((roomCode) => ({ roomCode, messages: stored<ChatMessage[]>(rows.chat, roomCode) })),
  };
}

/** Writes only the rows that differ from `previous`; null previous means no stored runtime. */
export function writeRuntimeRows(sql: Statements, next: RuntimeRows, previous: RuntimeRows | null): void {
  if (previous?.layout !== next.layout) {
    sql('INSERT INTO runtime_state (id, layout) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET layout = excluded.layout')
      .run(next.layout);
  }
  for (const [name, table, key] of RUNTIME_TABLES) {
    const before = previous?.[name];
    for (const [id, data] of next[name]) {
      if (before?.get(id) !== data) {
        sql(`INSERT INTO ${table} (${key}, data) VALUES (?, ?) ON CONFLICT (${key}) DO UPDATE SET data = excluded.data`).run(id, data);
      }
    }
    if (!before) continue;
    for (const id of before.keys()) {
      if (!next[name].has(id)) sql(`DELETE FROM ${table} WHERE ${key} = ?`).run(id);
    }
  }
}

// Whole documents: startup checks, import, and verification.

/** Reads every table in insertion order as a JSON database document. */
export function readDocument(sql: Statements): DatabaseDocument {
  const rewardedGameIds = sql('SELECT game_id FROM rewarded_games ORDER BY seq').all().map((row) => textColumn(row, 'game_id'));
  const runtime = readRuntimeRows(sql);
  const statsBackfill = readStatsBackfill(sql);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    accounts: sql(`${ACCOUNT_SELECT} ORDER BY a.seq`).all().map(accountFromRow),
    sessions: sql('SELECT * FROM sessions ORDER BY seq').all().map(sessionFromRow),
    friendships: sql('SELECT * FROM friendships ORDER BY seq').all().map(friendshipFromRow),
    matches: sql('SELECT record FROM matches ORDER BY seq').all().map(matchFromRow),
    emojis: sql('SELECT * FROM emojis ORDER BY seq').all().map(emojiFromRow),
    directMessages: sql('SELECT record FROM direct_messages ORDER BY seq').all().map(directMessageFromRow),
    messageReads: sql('SELECT * FROM message_reads ORDER BY seq').all().map(messageReadFromRow),
    friendNotifications: sql('SELECT * FROM friend_notifications ORDER BY seq').all().map(friendNotificationFromRow),
    gameStats: sql('SELECT record FROM game_stats ORDER BY seq').all().map(gameStatsFromRow),
    accountStats: sql('SELECT record FROM account_stats ORDER BY seq').all().map(accountStatsFromRow),
    runtime: runtime && parseRuntime(runtime),
    ...(rewardedGameIds.length > 0 ? { rewardedGameIds } : {}),
    ...(statsBackfill ? { statsBackfill } : {}),
  };
}

/**
 * Inserts a validated document without replacing anything: an existing key or a stored runtime
 * fails the statement, and the caller's transaction rolls everything back.
 */
export function insertDocument(sql: Statements, document: DatabaseDocument): void {
  for (const account of document.accounts) insertAccount(sql, account);
  for (const session of document.sessions) insertSession(sql, session);
  for (const friendship of document.friendships) insertFriendship(sql, friendship);
  for (const match of document.matches) {
    if (sql('SELECT 1 FROM matches WHERE id = ?').get(match.id)) throw new Error(`Match ${match.id} already exists.`);
    upsertMatchRow(sql, match);
  }
  for (const emoji of document.emojis) insertEmoji(sql, emoji);
  for (const message of document.directMessages) insertDirectMessage(sql, message);
  for (const cursor of document.messageReads) insertMessageRead(sql, cursor);
  for (const notification of document.friendNotifications) insertFriendNotification(sql, notification);
  for (const gameId of document.rewardedGameIds ?? []) sql('INSERT INTO rewarded_games (game_id) VALUES (?)').run(gameId);
  for (const record of document.gameStats) {
    if (sqliteStatsSource(sql).game(record.accountId, record.gameType, record.scope)) throw new Error('A game statistics record already exists.');
    upsertGameStats(sql, record);
  }
  for (const record of document.accountStats) {
    if (sqliteStatsSource(sql).account(record.accountId, record.scope)) throw new Error('An account statistics record already exists.');
    upsertAccountStats(sql, record);
  }
  if (document.statsBackfill) {
    if (readStatsBackfill(sql)) throw new Error('The target database already has a statistics backfill.');
    writeStatsBackfill(sql, document.statsBackfill);
  }
  if (document.runtime !== null) {
    if (sql('SELECT 1 FROM runtime_state WHERE id = 1').get()) throw new Error('The target database already has runtime state.');
    writeRuntimeRows(sql, serializeRuntime(document.runtime), null);
  }
}

/** Runtime references to accounts: players and chat senders are accounts; game seats are accounts or bots. */
export function runtimeReferencesValid(
  exists: (accountId: string) => boolean,
  players: readonly PersistedPlayer[], games: readonly AnyGameState[], chat: readonly (readonly ChatMessage[])[],
): boolean {
  return players.every((player) => exists(player.info.id)) &&
    games.every((game) => Object.values(game.players).every((player) => player.isBot
      ? botId(player.id) && !exists(player.id) : exists(player.id))) &&
    chat.every((messages) => messages.every((message) => exists(message.sender.id)));
}
