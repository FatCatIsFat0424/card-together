import { open } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { CURRENT_SCHEMA_VERSION } from './migrations';

/** Marks Card Together databases in the SQLite header ('CTDB'); other SQLite files are refused untouched. */
export const SQLITE_APPLICATION_ID = 0x43544442;

/** The document schema version that introduced SQLite storage. Older JSON documents migrate before import. */
export const SQLITE_BASELINE_VERSION = 7;

/** Waits for a lock held by another connection, such as an online backup, before failing. */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;

/** Bounds the WAL file left after checkpoints; its size otherwise stays at the largest burst. */
const JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/** Negative values are KiB: keeps hot account, history, and runtime pages in memory. */
const CACHE_SIZE_KIB = 32 * 1024;

type SqliteMigration = (database: DatabaseSync) => void;

/**
 * Index i upgrades SQLITE_BASELINE_VERSION + i to the next version inside one transaction, after a
 * backup. Append a step whenever CURRENT_SCHEMA_VERSION changes; never edit shipped steps.
 */
const SQLITE_STEPS: readonly SqliteMigration[] = [];

if (SQLITE_BASELINE_VERSION + SQLITE_STEPS.length !== CURRENT_SCHEMA_VERSION) {
  throw new Error('Every document schema version needs a SQLite migration step.');
}

/**
 * Columns hold keys, uniqueness, and ordering; `record` and `data` hold the validated JSON records
 * and per-room runtime state. `seq` preserves insertion order wherever the JSON arrays had one.
 */
const SCHEMA = `
CREATE TABLE accounts (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  username_normalized TEXT NOT NULL UNIQUE,
  nickname_search TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  record TEXT NOT NULL
) STRICT;
CREATE TABLE account_activity (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  last_seen_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
CREATE TABLE sessions (
  seq INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE friendships (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  requester_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id TEXT NOT NULL REFERENCES accounts(id),
  pair TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX friendships_requester ON friendships(requester_id);
CREATE INDEX friendships_recipient ON friendships(recipient_id);
CREATE TABLE matches (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  finished_at INTEGER NOT NULL,
  has_replay INTEGER NOT NULL CHECK (has_replay IN (0, 1)),
  record TEXT NOT NULL
) STRICT;
CREATE TABLE match_participants (
  match_seq INTEGER NOT NULL REFERENCES matches(seq) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (match_seq, position)
) STRICT, WITHOUT ROWID;
CREATE INDEX match_participants_history ON match_participants(account_id, finished_at DESC, match_seq);
CREATE TABLE emojis (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, name)
) STRICT;
CREATE TABLE direct_messages (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  sender_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id TEXT NOT NULL REFERENCES accounts(id),
  client_id TEXT NOT NULL,
  pair TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  record TEXT NOT NULL,
  UNIQUE (sender_id, client_id)
) STRICT;
CREATE INDEX direct_messages_sender ON direct_messages(sender_id, timestamp, seq);
CREATE INDEX direct_messages_recipient ON direct_messages(recipient_id, timestamp, seq);
CREATE INDEX direct_messages_pair ON direct_messages(pair, timestamp, seq);
CREATE INDEX direct_messages_timestamp ON direct_messages(timestamp);
CREATE TABLE message_reads (
  seq INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  other_id TEXT NOT NULL REFERENCES accounts(id),
  message_id TEXT NOT NULL REFERENCES direct_messages(id) ON DELETE CASCADE,
  UNIQUE (account_id, other_id)
) STRICT;
CREATE INDEX message_reads_message ON message_reads(message_id);
CREATE TABLE friend_notifications (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  actor_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX friend_notifications_account ON friend_notifications(account_id, created_at);
CREATE INDEX friend_notifications_created ON friend_notifications(created_at);
CREATE TABLE rewarded_games (
  seq INTEGER PRIMARY KEY,
  game_id TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE runtime_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  layout TEXT NOT NULL
) STRICT;
CREATE TABLE runtime_players (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  data TEXT NOT NULL
) STRICT;
CREATE TABLE runtime_rooms (
  room_code TEXT PRIMARY KEY,
  data TEXT NOT NULL
) STRICT;
CREATE TABLE runtime_games (
  room_code TEXT PRIMARY KEY,
  data TEXT NOT NULL
) STRICT;
CREATE TABLE runtime_chat (
  room_code TEXT PRIMARY KEY,
  data TEXT NOT NULL
) STRICT;
`;

const activePaths = new Set<string>();

/**
 * Reserves a database path for this process until the returned release function runs. Like the JSON
 * adapter, this guards within one process; the lock file (`owner-lock.ts`) guards across processes.
 */
export function claimSqlitePath(path: string): () => void {
  const key = process.platform === 'win32' ? path.toLowerCase() : path;
  if (activePaths.has(key)) {
    throw Object.assign(new Error('This database is already open. Close its repository before opening another.'),
      { code: 'DATABASE_IN_USE' });
  }
  activePaths.add(key);
  return () => { activePaths.delete(key); };
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function pragmaNumber(database: DatabaseSync, name: string): number {
  const row = database.prepare(`PRAGMA ${name}`).get();
  const value = row === undefined ? undefined : Object.values(row)[0];
  if (typeof value !== 'number') throw new Error(`SQLite PRAGMA ${name} returned no number.`);
  return value;
}

/** Runs `operation` in a write transaction; any failure rolls every statement back. */
export function inTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackError) {
      // SQLite already rolled back after some I/O errors; a still-open transaction fails the next BEGIN.
      if (!(rollbackError instanceof Error && /no transaction is active/.test(rollbackError.message))) {
        console.error('[database] SQLite rollback failed:', rollbackError);
      }
    }
    throw error;
  }
}

/**
 * Writes a consistent private copy of an open database. The target must not exist; VACUUM INTO
 * writes the snapshot and the file is synced before this resolves.
 */
export async function copySqliteDatabase(database: DatabaseSync, target: string): Promise<void> {
  // Create the file first so the copy keeps owner-only permissions.
  await (await open(target, 'wx', 0o600)).close();
  database.prepare('VACUUM INTO ?').run(target);
  const handle = await open(target, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function configure(database: DatabaseSync): void {
  database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  const journal = database.prepare('PRAGMA journal_mode = WAL').get();
  if (journal?.journal_mode !== 'wal') throw new Error('SQLite could not enable WAL mode for this database.');
  // FULL syncs the WAL on every commit, so a resolved write survives power loss like the JSON fsync.
  database.exec('PRAGMA synchronous = FULL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`PRAGMA journal_size_limit = ${JOURNAL_SIZE_LIMIT_BYTES}`);
  database.exec(`PRAGMA cache_size = -${CACHE_SIZE_KIB}`);
  if (pragmaNumber(database, 'synchronous') !== 2 || pragmaNumber(database, 'foreign_keys') !== 1) {
    throw new Error('SQLite durability or foreign key settings were not applied.');
  }
}

export interface OpenedSqliteDatabase {
  readonly database: DatabaseSync;
  /** The version found on disk before migration; null for a new database. */
  readonly previousVersion: number | null;
}

/**
 * Opens or creates a Card Together SQLite database at the current schema version. Unknown files,
 * other applications' databases, and newer versions are refused before anything is written.
 */
export async function openSqliteDatabase(path: string): Promise<OpenedSqliteDatabase> {
  try {
    await (await open(path, 'wx', 0o600)).close();
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const database = new DatabaseSync(path);
  try {
    database.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    // Read-only checks run first so a foreign file is never converted to WAL or migrated.
    const applicationId = pragmaNumber(database, 'application_id');
    const version = pragmaNumber(database, 'user_version');
    const tables = database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'").get()?.count;
    const empty = applicationId === 0 && version === 0 && tables === 0;
    if (!empty && applicationId !== SQLITE_APPLICATION_ID) {
      throw new Error('This SQLite file is not a Card Together database. It was not modified.');
    }
    if (!empty && (version < SQLITE_BASELINE_VERSION || version > CURRENT_SCHEMA_VERSION)) {
      throw new Error(`Unsupported database schema version: ${version}. Restore a compatible backup; the file was not modified.`);
    }
    configure(database);
    if (empty) {
      inTransaction(database, () => {
        database.exec(SCHEMA);
        database.exec(`PRAGMA application_id = ${SQLITE_APPLICATION_ID}`);
        database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
      });
      return { database, previousVersion: null };
    }
    if (version < CURRENT_SCHEMA_VERSION) {
      await copySqliteDatabase(database, `${path}.v${version}.bak`);
      inTransaction(database, () => {
        for (const step of SQLITE_STEPS.slice(version - SQLITE_BASELINE_VERSION)) step(database);
        database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
      });
    }
    return { database, previousVersion: version };
  } catch (error) {
    database.close();
    throw error;
  }
}
