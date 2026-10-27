import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { validateDocument } from './schema';
import { retainMatches } from './match-retention';
import { createReplayStore } from './replay-store';
import { backupMatchHistoryState } from './state-backup';

export interface MatchHistoryCleanup {
  readonly removed: number;
  readonly remaining: number;
  readonly backupPath: string | null;
}

/** Offline only: the caller must stop all database writers before applying cleanup. */
export async function cleanupMatchHistory(filePath: string, apply = false): Promise<MatchHistoryCleanup> {
  const path = resolve(filePath);
  const source = await lstat(path);
  if (!source.isFile() || source.nlink !== 1) {
    throw new Error('Database must be a regular file without symbolic or hard links.');
  }
  const original = await readFile(path, 'utf8');
  const document: unknown = JSON.parse(original);
  validateDocument(document);
  const matches = retainMatches(document.matches);
  const removed = document.matches.length - matches.length;
  if (!apply || removed === 0) return { removed, remaining: matches.length, backupPath: null };
  if (typeof process.getuid === 'function' && source.uid !== process.getuid()) {
    throw new Error('Run cleanup as the database file owner to preserve service access.');
  }
  const next = { ...document, matches };
  validateDocument(next);
  const backupPath = await backupMatchHistoryState(path, original);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  async function writeExclusive(target: string, contents: string): Promise<void> {
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  try {
    await writeExclusive(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
    if (await readFile(path, 'utf8') !== original) {
      throw new Error('Database changed during cleanup. Stop all writers and retry.');
    }
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  const retainedIds = new Set(matches.map((match) => match.id));
  await createReplayStore(join(dirname(path), 'replays')).remove(
    document.matches.filter((match) => !retainedIds.has(match.id)).map((match) => match.id),
  );
  return { removed, remaining: matches.length, backupPath };
}
