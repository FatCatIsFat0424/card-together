import { randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { validateDocument } from './schema';
import type { DatabaseDocument } from './schema';
import { retainMatches } from './match-retention';
import { assertDatabaseOwner, engineForPath, readDatabaseFile, resolveDatabasePath, statDatabaseFile } from './offline-database';
import { acquireDatabaseLock } from './owner-lock';
import { createReplayStore } from './replay-store';
import { copySqliteDatabase, inTransaction, openCurrentSqliteDatabase, sqliteDataVersion } from './sqlite-schema';
import { createStatements, readDocument } from './sqlite-store';
import { backupMatchHistoryState } from './state-backup';

export interface MatchHistoryCleanup {
  readonly removed: number;
  readonly remaining: number;
  readonly backupPath: string | null;
}

interface CleanupPlan {
  readonly document: DatabaseDocument;
  readonly retained: DatabaseDocument['matches'];
  readonly expired: readonly string[];
}

function plan(document: unknown): CleanupPlan {
  validateDocument(document);
  const retained = retainMatches(document.matches);
  const kept = new Set(retained.map((match) => match.id));
  return { document, retained, expired: document.matches.filter((match) => !kept.has(match.id)).map((match) => match.id) };
}

/** `removedIds` lists matches whose results were deleted; their archives go after the commit. */
interface CleanupOutcome {
  readonly result: MatchHistoryCleanup;
  readonly removedIds: readonly string[];
}

function outcome(cleanup: CleanupPlan, backupPath: string | null): CleanupOutcome {
  return {
    result: { removed: cleanup.expired.length, remaining: cleanup.retained.length, backupPath },
    removedIds: backupPath === null ? [] : cleanup.expired,
  };
}

async function writeExclusive(target: string, contents: string): Promise<void> {
  const handle = await open(target, 'wx', 0o600);
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function cleanupJson(path: string, apply: boolean): Promise<CleanupOutcome> {
  const original = (await readDatabaseFile(path)).contents.toString('utf8');
  const cleanup = plan(JSON.parse(original));
  if (!apply || cleanup.expired.length === 0) return outcome(cleanup, null);
  const next = { ...cleanup.document, matches: cleanup.retained };
  validateDocument(next);
  const backupPath = await backupMatchHistoryState(path, original);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeExclusive(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
    // Writers that predate the lock file are detected by a change to the file itself.
    if (await readFile(path, 'utf8') !== original) {
      throw new Error('Database changed during cleanup. Stop all writers and retry.');
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return outcome(cleanup, backupPath);
}

async function cleanupSqlite(path: string, apply: boolean): Promise<CleanupOutcome> {
  await statDatabaseFile(path);
  const database = openCurrentSqliteDatabase(path, { write: apply });
  try {
    const sql = createStatements(database);
    const cleanup = plan(readDocument(sql));
    if (!apply || cleanup.expired.length === 0) return outcome(cleanup, null);
    const version = sqliteDataVersion(database);
    const backupPath = await backupMatchHistoryState(path, (backup) => copySqliteDatabase(database, join(backup, basename(path))));
    inTransaction(database, () => {
      if (sqliteDataVersion(database) !== version) {
        throw new Error('Database changed during cleanup. Stop all writers and retry.');
      }
      for (const id of cleanup.expired) sql('DELETE FROM matches WHERE id = ?').run(id);
    });
    return outcome(cleanup, backupPath);
  } finally {
    database.close();
  }
}

/**
 * Offline only: previews, or applies after a complete backup, the per-account match retention rule.
 * Applying holds the database lock, so a running server refuses to start and is detected here.
 */
export async function cleanupMatchHistory(filePath: string, apply = false): Promise<MatchHistoryCleanup> {
  const path = await resolveDatabasePath(filePath);
  const run = engineForPath(path) === 'sqlite' ? cleanupSqlite : cleanupJson;
  if (!apply) return (await run(path, false)).result;
  assertDatabaseOwner(await statDatabaseFile(path), 'cleanup');
  const lock = await acquireDatabaseLock(path);
  try {
    const { result, removedIds } = await run(path, true);
    await createReplayStore(join(dirname(path), 'replays')).remove(removedIds);
    return result;
  } finally {
    await lock.release();
  }
}
