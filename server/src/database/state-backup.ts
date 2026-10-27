import { randomUUID } from 'node:crypto';
import { cp, mkdir, open, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Call only with exclusive database ownership, before pruning results or archive files. */
export async function backupMatchHistoryState(
  databasePath: string, original: string, replayDirectory = join(dirname(databasePath), 'replays'),
): Promise<string> {
  const backupPath = `${databasePath}.match-history-${randomUUID()}.bak`;
  await mkdir(backupPath, { mode: 0o700 });
  const handle = await open(join(backupPath, 'database.json'), 'wx', 0o600);
  try {
    await handle.writeFile(original, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (const [name, source] of [['media', join(dirname(databasePath), 'media')], ['replays', replayDirectory]]) {
    try {
      await stat(source);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    await cp(source, join(backupPath, name), { recursive: true, errorOnExist: true, force: false });
  }
  return backupPath;
}
