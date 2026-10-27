import { randomUUID } from 'node:crypto';
import { link, open, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { repositoryError } from './repository';

/** Held by the one process that may write a database file; other processes fail fast. */
export interface DatabaseLock {
  readonly path: string;
  /** Removes the lock file only while it still carries this owner's token. */
  release(): Promise<void>;
}

interface LockOwner {
  readonly pid: number;
  readonly hostname: string;
  /** Linux boot ID: a lock from an earlier boot cannot belong to a running process. */
  readonly bootId: string | null;
  /** Kernel start time of `pid`, which detects a reused PID. */
  readonly startTime: string | null;
  readonly token: string;
  readonly createdAt: string;
}

type OwnerState = 'alive' | 'dead' | 'unverifiable';

const ATTEMPTS = 3;

export function databaseLockPath(databasePath: string): string {
  return `${databasePath}.lock`;
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return null;
    throw error;
  }
}

async function currentBootId(): Promise<string | null> {
  return (await readOptional('/proc/sys/kernel/random/boot_id'))?.trim() || null;
}

/** Field 22 of /proc/<pid>/stat; the command name before it may contain spaces and parentheses. */
async function processStartTime(pid: number): Promise<string | null> {
  const stat = await readOptional(`/proc/${pid}/stat`).catch(() => null);
  if (!stat) return null;
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return fields[19] ?? null;
}

function parseOwner(text: string): LockOwner | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const owner = value as Record<string, unknown>;
    const optionalText = (field: unknown): boolean => field === null || typeof field === 'string';
    if (!Number.isSafeInteger(owner.pid) || (owner.pid as number) < 1 || typeof owner.hostname !== 'string'
      || !optionalText(owner.bootId) || !optionalText(owner.startTime) || typeof owner.token !== 'string'
      || typeof owner.createdAt !== 'string') return null;
    return value as LockOwner;
  } catch {
    return null;
  }
}

/**
 * A lock is stale only when its owner provably ended: an earlier boot, no such PID, or a PID now
 * used by a process that started at another time. Another host's PIDs cannot be checked here.
 */
async function ownerState(owner: LockOwner): Promise<OwnerState> {
  if (owner.hostname !== hostname()) return 'unverifiable';
  const bootId = await currentBootId();
  if (owner.bootId && bootId && owner.bootId !== bootId) return 'dead';
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (hasCode(error, 'ESRCH')) return 'dead';
    if (!hasCode(error, 'EPERM')) return 'unverifiable';
  }
  if (owner.startTime) {
    const startTime = await processStartTime(owner.pid);
    if (startTime !== null && startTime !== owner.startTime) return 'dead';
  }
  return 'alive';
}

/** Publishes complete contents atomically: link() fails instead of replacing an existing lock. */
async function createLockFile(path: string, contents: string): Promise<boolean> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporaryPath, path);
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function inUse(message: string): Error {
  return repositoryError('DATABASE_IN_USE', message);
}

/**
 * Moves the stale lock aside and deletes it only if it is still the file that was judged stale;
 * a lock another starting process created in the meantime is put back.
 */
async function removeStaleLock(path: string, stale: LockOwner): Promise<void> {
  const aside = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, aside);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  const moved = parseOwner(await readFile(aside, 'utf8').catch(() => ''));
  if (moved?.token === stale.token) {
    await unlink(aside);
    return;
  }
  try {
    await link(aside, path);
  } catch {
    throw inUse(`Another process changed the database lock ${path} during recovery; its lock was kept at ${aside}. `
      + 'Confirm which process uses the database before retrying.');
  }
  await unlink(aside).catch(() => undefined);
  throw inUse(`Another process (PID ${moved?.pid ?? 'unknown'}) took over the database lock ${path}.`);
}

/**
 * Claims single-writer ownership of a database across processes with `<database>.lock`. A lock whose
 * owner provably ended is replaced; a live, unverifiable, or unreadable lock fails with
 * DATABASE_IN_USE and is never removed.
 */
export async function acquireDatabaseLock(databasePath: string): Promise<DatabaseLock> {
  const path = databaseLockPath(databasePath);
  const owner: LockOwner = {
    pid: process.pid, hostname: hostname(), bootId: await currentBootId(), startTime: await processStartTime(process.pid),
    token: randomUUID(), createdAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (await createLockFile(path, `${JSON.stringify(owner)}\n`)) return heldLock(path, owner.token);
    const text = await readOptional(path);
    if (text === null) continue;
    const existing = parseOwner(text);
    if (!existing) {
      throw inUse(`The database lock ${path} is unreadable. Confirm that no process uses the database before removing it.`);
    }
    const state = await ownerState(existing);
    if (state === 'alive') {
      throw inUse(`Another process (PID ${existing.pid}) owns this database. Stop it before opening ${databasePath}.`);
    }
    if (state === 'unverifiable') {
      throw inUse(`The database lock ${path} belongs to PID ${existing.pid} on ${existing.hostname} and cannot be checked here. `
        + 'Confirm that no process uses the database before removing it.');
    }
    await removeStaleLock(path, existing);
    console.warn(`[database] Replaced a stale lock left by PID ${existing.pid} (${existing.createdAt}).`);
  }
  throw inUse(`Unable to acquire the database lock ${path}; another process keeps replacing it.`);
}

function heldLock(path: string, token: string): DatabaseLock {
  let released = false;
  return {
    path,
    release: async () => {
      if (released) return;
      released = true;
      const current = await readOptional(path);
      if (current === null) return;
      if (parseOwner(current)?.token !== token) {
        console.warn(`[database] The lock ${path} no longer belongs to this process; it was left in place.`);
        return;
      }
      await unlink(path);
    },
  };
}
