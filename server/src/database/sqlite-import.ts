import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { dropUnplayableRecordings } from './match-replay';
import { migrateDocument } from './migrations';
import type { DatabaseLock } from './owner-lock';
import { acquireDatabaseLock } from './owner-lock';
import { repositoryError } from './repository';
import type { DatabaseDocument } from './schema';
import { validateDocument } from './schema';
import { claimSqlitePath, inTransaction, openSqliteDatabase } from './sqlite-schema';
import type { Statements } from './sqlite-store';
import { createStatements, insertDocument, integerColumn, readDocument } from './sqlite-store';

const COUNTED_TABLES = {
  accounts: 'accounts', sessions: 'sessions', friendships: 'friendships', matches: 'matches', emojis: 'emojis',
  directMessages: 'direct_messages', messageReads: 'message_reads', friendNotifications: 'friend_notifications',
  rewardedGameIds: 'rewarded_games',
} as const;

export type ImportCounts = Record<keyof typeof COUNTED_TABLES, number>;

export interface JsonImportResult {
  /** Rows added per collection. */
  readonly imported: ImportCounts;
  readonly runtime: boolean;
  /** In-progress games whose replay recording no longer applied; they continue unrecorded, as at JSON startup. */
  readonly droppedRecordings: readonly string[];
}

function counts(sql: Statements): ImportCounts {
  return Object.fromEntries(Object.entries(COUNTED_TABLES).map(([name, table]) => {
    const row = sql(`SELECT COUNT(*) AS count FROM ${table}`).get();
    if (!row) throw new Error(`Unable to count ${table}.`);
    return [name, integerColumn(row, 'count')];
  })) as ImportCounts;
}

/** Records per collection, keyed like the import result. */
export function documentCounts(document: DatabaseDocument): ImportCounts {
  return {
    accounts: document.accounts.length, sessions: document.sessions.length, friendships: document.friendships.length,
    matches: document.matches.length, emojis: document.emojis.length, directMessages: document.directMessages.length,
    messageReads: document.messageReads.length, friendNotifications: document.friendNotifications.length,
    rewardedGameIds: document.rewardedGameIds?.length ?? 0,
  };
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && 'errstr' in error && error.errstr === 'constraint failed';
}

/**
 * Imports a JSON database document (any supported schema version) into a SQLite database in one
 * transaction, keeping IDs, password hashes, expirations, media references, and record order.
 * Existing rows are never replaced: any duplicate key, friend pair, or stored runtime refuses the
 * whole import. Afterwards it verifies row counts, uniqueness, references, and that every imported
 * record reads back unchanged. Replay archives and media stay as files beside the database.
 * The caller must stop every writer of both databases first.
 */
export async function importJsonDocument(source: unknown, databasePath: string): Promise<JsonImportResult> {
  const document = migrateDocument(source);
  const droppedRecordings = dropUnplayableRecordings(document);
  validateDocument(document);
  const path = resolve(databasePath);
  await mkdir(dirname(path), { recursive: true });
  const release = claimSqlitePath(path);
  let lock: DatabaseLock | undefined;
  let database: DatabaseSync | undefined;
  try {
    lock = await acquireDatabaseLock(path);
    ({ database } = await openSqliteDatabase(path));
    const db: DatabaseSync = database;
    const sql = createStatements(db);
    return inTransaction(db, () => {
      const before = counts(sql);
      try {
        insertDocument(sql, document);
      } catch (error) {
        if (error instanceof Error && (isConstraintError(error) || /already (exists|has runtime)/.test(error.message))) {
          throw repositoryError('IMPORT_CONFLICT', `The target database already has conflicting data (${error.message}). Nothing was imported.`);
        }
        throw error;
      }
      const after = counts(sql);
      const imported = documentCounts(document);
      for (const name of Object.keys(COUNTED_TABLES) as (keyof ImportCounts)[]) {
        if (after[name] - before[name] !== imported[name]) throw new Error(`Imported ${name} count does not match the source.`);
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('Imported rows have broken references.');
      // Uniqueness and references of the merged result, then a read-back of every imported record.
      const stored = readDocument(sql);
      validateDocument(stored, { applyReplaySteps: false });
      verifyReadBack(document, stored);
      return { imported, runtime: document.runtime !== null, droppedRecordings };
    });
  } finally {
    database?.close();
    await lock?.release();
    release();
  }
}

function verifyReadBack(source: DatabaseDocument, stored: DatabaseDocument): void {
  const collections = ['accounts', 'sessions', 'friendships', 'matches', 'emojis', 'directMessages', 'messageReads',
    'friendNotifications'] as const;
  for (const name of collections) {
    const rows: readonly unknown[] = stored[name];
    const imported: readonly unknown[] = source[name];
    // Imported rows follow any rows the target already had, in source order.
    if (!isDeepStrictEqual(rows.slice(rows.length - imported.length), JSON.parse(JSON.stringify(imported)))) {
      throw new Error(`Imported ${name} do not read back unchanged.`);
    }
  }
  if (source.runtime !== null && !isDeepStrictEqual(stored.runtime, JSON.parse(JSON.stringify(source.runtime)))) {
    throw new Error('Imported runtime does not read back unchanged.');
  }
}
