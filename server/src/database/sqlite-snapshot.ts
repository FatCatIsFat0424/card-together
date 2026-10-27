import { unlink } from 'node:fs/promises';
import { dropUnplayableRecordings } from './match-replay';
import { migrateDocument } from './migrations';
import { engineForPath, pathExists, readDatabaseFile, resolveDatabasePath, statDatabaseFile } from './offline-database';
import { isObject, validateDocument } from './schema';
import type { ImportCounts } from './sqlite-import';
import { documentCounts } from './sqlite-import';
import { copySqliteDatabase, openCurrentSqliteDatabase } from './sqlite-schema';
import type { SqliteVerification } from './sqlite-verify';
import { checkSqliteStructure, readValidatedDocument } from './sqlite-verify';

export interface SnapshotVerification {
  readonly path: string;
  readonly bytes: number;
  readonly schemaVersion: number;
  readonly collections: ImportCounts;
  /** In-progress games whose replay recording no longer applies; the server drops them at startup. */
  readonly droppedRecordings: readonly string[];
  /** SQLite only: structural checks and rows per table. */
  readonly sqlite?: SqliteVerification;
}

/**
 * Checks that a database file is one this server version can start from: SQLite structure checks
 * plus the same whole-document validation as startup. Older JSON versions pass when they migrate.
 */
export async function verifyDatabaseSnapshot(filePath: string): Promise<SnapshotVerification> {
  const path = await resolveDatabasePath(filePath);
  if (engineForPath(path) === 'json') {
    const { stats, contents } = await readDatabaseFile(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON database snapshot.');
    }
    const schemaVersion = isObject(parsed) && typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
    const document = migrateDocument(parsed);
    const droppedRecordings = dropUnplayableRecordings(document);
    validateDocument(document);
    return { path, bytes: stats.size, schemaVersion, collections: documentCounts(document), droppedRecordings };
  }
  const stats = await statDatabaseFile(path);
  const database = openCurrentSqliteDatabase(path);
  try {
    const sqlite = checkSqliteStructure(database);
    const { document, droppedRecordings } = readValidatedDocument(database);
    return { path, bytes: stats.size, schemaVersion: document.schemaVersion, collections: documentCounts(document), droppedRecordings, sqlite };
  } finally {
    database.close();
  }
}

/**
 * Online backup: copies a SQLite database that a running server may own into a new private file
 * with VACUUM INTO, then verifies the copy. Run as the database owner so the WAL index stays
 * shared with the server; the copy is a single file in rollback-journal mode.
 */
export async function snapshotSqliteDatabase(sourcePath: string, targetPath: string): Promise<SnapshotVerification> {
  const source = await resolveDatabasePath(sourcePath);
  const target = await resolveDatabasePath(targetPath);
  if (engineForPath(source) !== 'sqlite' || engineForPath(target) !== 'sqlite') throw new Error('Snapshots copy .sqlite files.');
  if (await pathExists(target)) throw new Error(`The snapshot target ${target} already exists.`);
  await statDatabaseFile(source);
  // Not query_only: VACUUM INTO needs a writable connection, although it writes only the target.
  const database = openCurrentSqliteDatabase(source, { write: true });
  try {
    await copySqliteDatabase(database, target);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  } finally {
    database.close();
  }
  try {
    return await verifyDatabaseSnapshot(target);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
}
