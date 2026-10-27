import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { DatabaseEngine } from '../config';

/** Offline tools infer the engine from the extension, which the server configuration also requires. */
export function engineForPath(path: string): DatabaseEngine {
  const extension = extname(path);
  if (extension === '.json') return 'json';
  if (extension === '.sqlite') return 'sqlite';
  throw new Error('The database path must end with .json or .sqlite.');
}

/**
 * Resolves symbolic links in the parent directory but never in the file name, so tools act on the
 * same path (and lock) as the server, and a linked database file is refused rather than followed.
 */
export async function resolveDatabasePath(filePath: string): Promise<string> {
  const requested = resolve(filePath);
  return join(await realpath(dirname(requested)), basename(requested));
}

/** Opens a database file without following links; it must be a regular file without hard links. */
async function withDatabaseFile<T>(path: string, use: (handle: FileHandle, stats: Stats) => Promise<T>): Promise<T> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.nlink !== 1) {
      throw new Error('The database must be a regular file without hard links or symbolic links.');
    }
    return await use(handle, stats);
  } finally {
    await handle.close();
  }
}

export function readDatabaseFile(path: string): Promise<{ readonly stats: Stats; readonly contents: Buffer }> {
  return withDatabaseFile(path, async (handle, stats) => ({ stats, contents: await handle.readFile() }));
}

export function statDatabaseFile(path: string): Promise<Stats> {
  return withDatabaseFile(path, async (_handle, stats) => stats);
}

/** Files written by a different user could lock the service out of its own state. */
export function assertDatabaseOwner(stats: Stats, action: string): void {
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`Run ${action} as the database file owner to preserve service access.`);
  }
}
