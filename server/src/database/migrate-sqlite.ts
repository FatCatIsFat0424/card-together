import type { Stats } from 'node:fs';
import { lstat, stat, truncate, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { dropUnplayableRecordings } from './match-replay';
import { migrateDocument } from './migrations';
import {
  assertDatabaseOwner, assertSpace, availableBytes, engineForPath, pathExists, readDatabaseFile, resolveDatabasePath,
} from './offline-database';
import { acquireDatabaseLock, databaseLockPath } from './owner-lock';
import { isObject, validateDocument } from './schema';
import type { ImportCounts } from './sqlite-import';
import { documentCounts, importJsonDocument } from './sqlite-import';
import { openCurrentSqliteDatabase } from './sqlite-schema';
import type { SqliteVerification } from './sqlite-verify';
import { checkSqliteStructure } from './sqlite-verify';

/**
 * Peak space for the import relative to the JSON size: the SQLite file is about 2.2 times larger,
 * and the single import transaction also passes through the WAL before the final checkpoint.
 */
export const MIGRATION_SPACE_FACTOR = 5;

export interface SqliteMigrationPreview {
  readonly source: string;
  readonly target: string;
  readonly sourceSchemaVersion: number | null;
  /** Records per collection that the import will write. */
  readonly collections: ImportCounts;
  readonly runtime: boolean;
  /** In-progress games whose replay recording no longer applies; they continue unrecorded. */
  readonly droppedRecordings: readonly string[];
  readonly sourceBytes: number;
  readonly requiredBytes: number;
  readonly availableBytes: number;
}

export interface SqliteMigrationResult extends SqliteMigrationPreview {
  readonly targetBytes: number;
  readonly verification: SqliteVerification & { readonly countsMatch: true; readonly readBack: true };
}

interface Inspected {
  readonly preview: SqliteMigrationPreview;
  readonly sourceStats: Stats;
  readonly contents: Buffer;
  /** Null when the target does not exist yet; an existing target must be an empty file. */
  readonly targetStats: Stats | null;
}

const JOURNAL_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

function parseJson(contents: Buffer): unknown {
  try {
    return JSON.parse(contents.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON database; the original file was preserved.');
  }
}

/** The target must not exist or must be an empty regular file owned by this user, without journals or a lock. */
async function inspectTarget(target: string): Promise<Stats | null> {
  for (const leftover of [...JOURNAL_SUFFIXES.map((suffix) => `${target}${suffix}`), databaseLockPath(target)]) {
    if (await pathExists(leftover)) throw new Error(`Remove or review ${leftover} before migrating; it belongs to another database.`);
  }
  let stats: Stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stats.isFile() || stats.nlink !== 1 || stats.size !== 0) {
    throw new Error('The SQLite target must not exist or must be an empty regular file without links. Nothing was written.');
  }
  assertDatabaseOwner(stats, 'the migration');
  return stats;
}

async function inspect(sourcePath: string, targetPath: string): Promise<Inspected> {
  const source = await resolveDatabasePath(sourcePath);
  const target = await resolveDatabasePath(targetPath);
  if (engineForPath(source) !== 'json') throw new Error('The source must be a .json database.');
  if (engineForPath(target) !== 'sqlite') throw new Error('The target must be a .sqlite database.');
  if (dirname(source) !== dirname(target)) {
    throw new Error('Create the SQLite database in the same directory as the JSON database, so media/ and replays/ stay beside it.');
  }
  const { stats: sourceStats, contents } = await readDatabaseFile(source);
  const parsed = parseJson(contents);
  const document = migrateDocument(parsed);
  const droppedRecordings = dropUnplayableRecordings(document);
  validateDocument(document);
  const targetStats = await inspectTarget(target);
  const directory = dirname(target);
  return {
    preview: {
      source, target, sourceSchemaVersion: isObject(parsed) && typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : null,
      collections: documentCounts(document), runtime: document.runtime !== null, droppedRecordings,
      sourceBytes: contents.length, requiredBytes: contents.length * MIGRATION_SPACE_FACTOR,
      availableBytes: await availableBytes(directory),
    },
    sourceStats, contents, targetStats,
  };
}

/** Read-only: validates the JSON database and the target, and reports what the import would write. */
export async function previewSqliteMigration(sourcePath: string, targetPath: string): Promise<SqliteMigrationPreview> {
  return (await inspect(sourcePath, targetPath)).preview;
}

/** Undoes a failed migration: the target returns to absent or empty, and its journals are removed. */
async function discardTarget(target: string, existed: boolean): Promise<void> {
  for (const suffix of JOURNAL_SUFFIXES) await unlink(`${target}${suffix}`).catch(() => undefined);
  if (existed) await truncate(target, 0);
  else await unlink(target).catch(() => undefined);
}

function verifyTarget(target: string, expected: ImportCounts): SqliteMigrationResult['verification'] {
  const database = openCurrentSqliteDatabase(target);
  try {
    const structure = checkSqliteStructure(database);
    const tables: Record<keyof ImportCounts, string> = {
      accounts: 'accounts', sessions: 'sessions', friendships: 'friendships', matches: 'matches', emojis: 'emojis',
      directMessages: 'direct_messages', messageReads: 'message_reads', friendNotifications: 'friend_notifications',
      rewardedGameIds: 'rewarded_games', gameStats: 'game_stats', accountStats: 'account_stats',
    };
    for (const [name, table] of Object.entries(tables) as [keyof ImportCounts, string][]) {
      if (structure.tables[table] !== expected[name]) throw new Error(`SQLite ${table} has ${structure.tables[table]} rows; expected ${expected[name]}.`);
    }
    return { ...structure, countsMatch: true, readBack: true };
  } finally {
    database.close();
  }
}

/**
 * Offline only: imports the JSON database into a new SQLite file beside it. Holds the JSON database
 * lock, never modifies the JSON file, and removes the partial target if anything fails.
 */
export async function migrateJsonToSqlite(
  sourcePath: string, targetPath: string, options: { readonly writersStopped: boolean },
): Promise<SqliteMigrationResult> {
  if (!options.writersStopped) throw new Error('Stop all database writers before migrating.');
  const first = await inspect(sourcePath, targetPath);
  const { source, target } = first.preview;
  assertDatabaseOwner(first.sourceStats, 'the migration');
  const lock = await acquireDatabaseLock(source);
  try {
    // Checked again under the lock: the source must be the previewed bytes and the target still unused.
    const current = await inspect(source, target);
    if (!current.contents.equals(first.contents)) throw new Error('The JSON database changed after preview. Stop all writers and retry.');
    assertSpace(current.preview.availableBytes, current.preview.requiredBytes, dirname(target));
    let imported: Awaited<ReturnType<typeof importJsonDocument>>;
    let verification: SqliteMigrationResult['verification'];
    try {
      imported = await importJsonDocument(parseJson(current.contents), target);
      const after = await readDatabaseFile(source);
      if (after.stats.ino !== current.sourceStats.ino || !after.contents.equals(current.contents)) {
        throw new Error('The JSON database changed during the migration. Stop all writers and retry.');
      }
      verification = verifyTarget(target, current.preview.collections);
    } catch (error) {
      await discardTarget(target, current.targetStats !== null);
      throw error;
    }
    return {
      ...current.preview, droppedRecordings: imported.droppedRecordings,
      targetBytes: (await stat(target)).size, verification,
    };
  } finally {
    await lock.release();
  }
}
