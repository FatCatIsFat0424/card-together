import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isReplayRecordId } from '@shared/replay-session';
import type { MatchReplay } from '@shared/types';

const ARCHIVE_SUFFIX = '.json';
const TEMPORARY_SUFFIX = '.tmp';

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** One file per match beside the database; only the repository that owns the database writes it. */
export interface ReplayStore {
  /** Writes once per completed match: temporary file, fsync, then rename. */
  write(matchId: string, replay: MatchReplay): Promise<void>;
  /** Parsed contents, or undefined when no file exists. Invalid JSON and I/O errors reject. */
  read(matchId: string): Promise<unknown>;
  /** Best effort: failures are logged, and startup sweeps whatever remains. */
  remove(matchIds: Iterable<string>): Promise<void>;
  /**
   * Deletes leftover temporary files and archives whose match is not flagged, such as files
   * written before a failed commit. Resolves the flagged IDs that have no archive.
   */
  sweep(flagged: ReadonlySet<string>): Promise<string[]>;
}

/** Match IDs become file names, so anything outside the record ID format is rejected. */
function archiveName(matchId: string): string {
  if (!isReplayRecordId(matchId)) throw new Error('Invalid match replay ID.');
  return `${matchId}${ARCHIVE_SUFFIX}`;
}

export function createReplayStore(directory: string): ReplayStore {
  const root = resolve(directory);

  async function removeFile(name: string): Promise<void> {
    try {
      await unlink(join(root, name));
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) console.error(`[replays] Unable to delete ${name}:`, error);
    }
  }

  return {
    async write(matchId, replay) {
      const target = join(root, archiveName(matchId));
      await mkdir(root, { recursive: true, mode: 0o700 });
      const temporaryPath = `${target}.${randomUUID()}${TEMPORARY_SUFFIX}`;
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(replay)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, target);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    },
    async read(matchId) {
      let text: string;
      try {
        text = await readFile(join(root, archiveName(matchId)), 'utf8');
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return undefined;
        throw error;
      }
      return JSON.parse(text) as unknown;
    },
    async remove(matchIds) {
      for (const matchId of new Set(matchIds)) {
        if (isReplayRecordId(matchId)) await removeFile(archiveName(matchId));
      }
    },
    async sweep(flagged) {
      let names: string[];
      try {
        names = await readdir(root);
      } catch (error) {
        if (hasCode(error, 'ENOENT')) return [...flagged];
        throw error;
      }
      const stored = new Set<string>();
      for (const name of names) {
        const matchId = name.endsWith(ARCHIVE_SUFFIX) ? name.slice(0, -ARCHIVE_SUFFIX.length) : null;
        if (matchId !== null && isReplayRecordId(matchId)) {
          if (flagged.has(matchId)) stored.add(matchId);
          else await removeFile(name);
        } else if (name.endsWith(TEMPORARY_SUFFIX) && name.includes(`${ARCHIVE_SUFFIX}.`)) {
          await removeFile(name);
        }
      }
      return [...flagged].filter((matchId) => !stored.has(matchId));
    },
  };
}
