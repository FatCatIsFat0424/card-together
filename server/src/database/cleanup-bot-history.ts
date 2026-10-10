import { randomUUID } from 'node:crypto';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDocument } from './schema';

export interface BotHistoryCleanup {
  readonly removed: number;
  readonly remaining: number;
  readonly backupPath: string | null;
}

/** Offline only: the caller must stop all database writers before applying cleanup. */
export async function cleanupBotHistory(filePath: string, apply = false): Promise<BotHistoryCleanup> {
  const path = resolve(filePath);
  const original = await readFile(path, 'utf8');
  const document: unknown = JSON.parse(original);
  validateDocument(document);
  const matches = document.matches.filter((match) => !match.accountIds.some((id) => id.startsWith('bot:')));
  const removed = document.matches.length - matches.length;
  if (!apply || removed === 0) return { removed, remaining: matches.length, backupPath: null };
  const source = await stat(path);
  if (typeof process.getuid === 'function' && source.uid !== process.getuid()) {
    throw new Error('Run cleanup as the database file owner to preserve service access.');
  }
  const next = { ...document, matches };
  validateDocument(next);
  const backupPath = `${path}.bot-history-${randomUUID()}.bak`;
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
  // Preserve the complete database, including accounts, media references and runtime.
  await writeExclusive(backupPath, original);
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
  return { removed, remaining: matches.length, backupPath };
}
