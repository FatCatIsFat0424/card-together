import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import type { DatabaseEngine } from '../../src/config';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository, RepositoryOptions } from '../../src/database/repository';
import type { DatabaseDocument } from '../../src/database/schema';
import { importJsonDocument } from '../../src/database/sqlite-import';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import { inTransaction, openSqliteDatabase } from '../../src/database/sqlite-schema';
import { createStatements, insertDocument, readDocument } from '../../src/database/sqlite-store';

const SQLITE_TABLES = [
  'stats_backfill', 'account_stats', 'game_stats', 'runtime_chat', 'runtime_games', 'runtime_rooms', 'runtime_players',
  'runtime_state', 'rewarded_games',
  'friend_notifications', 'message_reads', 'direct_messages', 'emojis', 'match_participants', 'matches', 'friendships',
  'sessions', 'account_activity', 'accounts',
] as const;

/** Runs Repository contract tests against each storage engine. */
export interface RepositoryAdapter {
  readonly name: DatabaseEngine;
  readonly fileName: string;
  open(path: string, options?: RepositoryOptions): Promise<Repository>;
  /** Writes a valid document as the initial state of a database that is not open. */
  seed(path: string, document: DatabaseDocument): Promise<void>;
  /** The durable state read without the repository, for before/after comparisons. */
  persisted(path: string): Promise<string>;
  readDocument(path: string): Promise<DatabaseDocument>;
  /** Stores a possibly invalid document, bypassing validation and references, to test startup checks. */
  writeUnchecked(path: string, document: unknown): Promise<void>;
  /**
   * Fails the next durable commit after the operation staged its changes. The JSON adapter fails its
   * rename, so test files using it must mock `rename` from `node:fs/promises` with `vi.fn`.
   */
  failNextCommit(error: Error): void;
  /**
   * Fails every commit of the database at `path`, but not replay archive writes, until the returned
   * function runs. `beforeFailing` observes the moment each commit would have happened.
   */
  failCommits(path: string, error: Error, beforeFailing?: () => void): () => void;
  /** Directory entries other than the database, its journal files, and its owner lock. */
  otherFiles(directory: string): Promise<string[]>;
}

function readSqliteDocument(path: string): DatabaseDocument {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return readDocument(createStatements(database));
  } finally {
    database.close();
  }
}

export const JSON_ADAPTER: RepositoryAdapter = {
  name: 'json',
  fileName: 'database.json',
  open: (path, options) => createJsonRepository(path, options),
  seed: (path, document) => writeFile(path, JSON.stringify(document)),
  persisted: (path) => readFile(path, 'utf8'),
  readDocument: async (path) => JSON.parse(await readFile(path, 'utf8')) as DatabaseDocument,
  writeUnchecked: (path, document) => writeFile(path, JSON.stringify(document)),
  failNextCommit: (error) => { vi.mocked(rename).mockRejectedValueOnce(error); },
  failCommits: (path, error, beforeFailing) => {
    const original = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (to !== path) return original(from, to);
      beforeFailing?.();
      throw error;
    });
    return () => { vi.mocked(rename).mockImplementation(original); };
  },
  otherFiles: async (directory) => (await readdir(directory)).filter((name) => name !== 'database.json' && name !== 'database.json.lock'),
};

export const SQLITE_ADAPTER: RepositoryAdapter = {
  name: 'sqlite',
  fileName: 'database.sqlite',
  open: (path, options) => createSqliteRepository(path, options),
  seed: async (path, document) => { await importJsonDocument(document, path); },
  persisted: async (path) => JSON.stringify(readSqliteDocument(path)),
  readDocument: async (path) => readSqliteDocument(path),
  writeUnchecked: async (path, document) => {
    (await openSqliteDatabase(path)).database.close();
    const database = new DatabaseSync(path);
    try {
      // Unique keys still apply: SQLite cannot store the duplicates a JSON file can.
      database.exec('PRAGMA foreign_keys = OFF');
      const sql = createStatements(database);
      const data = document as DatabaseDocument;
      inTransaction(database, () => {
        for (const table of SQLITE_TABLES) database.exec(`DELETE FROM ${table}`);
        for (const account of data.accounts) {
          sql('INSERT INTO accounts (id, username_normalized, nickname_search, password_hash, record) VALUES (?, ?, ?, ?, ?)')
            .run(account.id, account.usernameNormalized, String(account.nickname).toLowerCase(), account.passwordHash,
              JSON.stringify(account));
        }
        insertDocument(sql, { ...data, accounts: [] });
      });
    } finally {
      database.close();
    }
  },
  failNextCommit: (error) => {
    const exec = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql !== 'COMMIT') return exec.call(this, sql);
      spy.mockRestore();
      throw error;
    });
  },
  failCommits: (_path, error, beforeFailing) => {
    const exec = DatabaseSync.prototype.exec;
    const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (sql !== 'COMMIT') return exec.call(this, sql);
      beforeFailing?.();
      throw error;
    });
    return () => { spy.mockRestore(); };
  },
  otherFiles: async (directory) => (await readdir(directory))
    .filter((name) => !/^database\.sqlite(?:-wal|-shm|-journal|\.lock)?$/.test(name)),
};

export const REPOSITORY_ADAPTERS: readonly RepositoryAdapter[] = [JSON_ADAPTER, SQLITE_ADAPTER];
