import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { open, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isUsername } from '@shared/constants';
import { validateDocument } from '../database/schema';
import type { DatabaseDocument } from '../database/schema';
import type { AccountRecord } from '../database/repository';
import { hashPassword } from './password';
import { validateNewPassword } from './password-policy';

export interface PasswordResetPreview {
  readonly databasePath: string;
  readonly accountId: string;
  readonly username: string;
  readonly sessionsRevoked: number;
}

export interface PasswordResetResult extends PasswordResetPreview {
  readonly backupPath: string;
  readonly warnings: readonly string[];
}

interface PasswordResetTarget {
  readonly path: string;
  readonly source: Stats;
  readonly original: Buffer;
  readonly document: DatabaseDocument;
  readonly index: number;
  readonly account: AccountRecord;
}

async function readTarget(filePath: string, username: string): Promise<PasswordResetTarget> {
  const requestedPath = resolve(filePath);
  const path = join(await realpath(dirname(requestedPath)), basename(requestedPath));
  const normalized = username.trim().toLowerCase();
  if (!isUsername(normalized)) throw new Error('Enter a valid account username, not a nickname or account ID.');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const source = await handle.stat();
    if (!source.isFile() || source.nlink !== 1) {
      throw new Error('The database must be a regular file without hard links or symbolic links.');
    }
    const original = await handle.readFile();
    let document: unknown;
    try {
      document = JSON.parse(original.toString('utf8'));
    } catch {
      throw new Error('Invalid JSON database; the original file was preserved.');
    }
    validateDocument(document);
    const index = document.accounts.findIndex((account) => account.usernameNormalized === normalized);
    if (index < 0) throw new Error('Account not found. Use its username, not its nickname.');
    const account = document.accounts[index];
    return { path, source, original, document, index, account };
  } finally {
    await handle.close();
  }
}

function preview(target: PasswordResetTarget): PasswordResetPreview {
  return {
    databasePath: target.path,
    accountId: target.account.id,
    username: target.account.username,
    sessionsRevoked: target.document.sessions.filter((session) => session.accountId === target.account.id).length,
  };
}

export async function inspectPasswordReset(filePath: string, username: string): Promise<PasswordResetPreview> {
  return preview(await readTarget(filePath, username));
}

async function writeExclusive(path: string, contents: string | Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  } finally {
    await handle.close();
  }
}

/** Offline only: the acknowledgement does not stop or detect application writers. */
export async function resetAccountPassword(
  filePath: string,
  username: string,
  newPassword: string,
  options: { readonly writersStopped: boolean; readonly expectedAccountId?: string; readonly now?: () => number },
): Promise<PasswordResetResult> {
  if (!options.writersStopped) throw new Error('Stop all database writers before resetting a password.');
  const password = validateNewPassword(newPassword);
  const target = await readTarget(filePath, username);
  if (options.expectedAccountId !== undefined && target.account.id !== options.expectedAccountId) {
    throw new Error('The target account changed after preview; no reset was applied.');
  }
  if (typeof process.getuid === 'function' && target.source.uid !== process.getuid()) {
    throw new Error('Run password reset as the database file owner to preserve service access.');
  }
  const lockPath = `${target.path}.password-reset.lock`;
  let lock: FileHandle;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('A password reset lock exists. Check for an active reset process before removing a stale lock.', { cause: error });
    }
    throw error;
  }
  const temporaryPath = `${target.path}.${randomUUID()}.tmp`;
  const backupPath = `${target.path}.password-reset-${randomUUID()}.bak`;
  const warnings: string[] = [];
  let failure: { readonly error: unknown } | undefined;
  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid })}\n`);
    await lock.sync();
    const passwordHash = await hashPassword(password);
    const now = (options.now ?? Date.now)();
    const next = {
      ...target.document,
      accounts: target.document.accounts.map((account, index) => index === target.index
        ? { ...account, passwordHash, updatedAt: Math.max(now, account.updatedAt + 1) } : account),
      sessions: target.document.sessions.filter((session) => session.accountId !== target.account.id),
    };
    validateDocument(next);
    await writeExclusive(backupPath, target.original);
    await writeExclusive(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
    const current = await readTarget(target.path, username);
    if (current.source.dev !== target.source.dev || current.source.ino !== target.source.ino
      || !current.original.equals(target.original)) {
      throw new Error(`Database changed during reset; no reset was applied. Backup: ${backupPath}`);
    }
    await rename(temporaryPath, target.path);
  } catch (error) {
    failure = { error };
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        warnings.push(`Unable to remove temporary file: ${temporaryPath}`);
      }
    });
    await lock.close().catch(() => warnings.push('Unable to close the password reset lock.'));
    await unlink(lockPath).catch(() => warnings.push(`Unable to remove password reset lock: ${lockPath}`));
  }
  if (failure) {
    if (warnings.length) throw new Error(`Reset was not applied. Cleanup needs attention: ${warnings.join(' ')}`, { cause: failure.error });
    throw failure.error;
  }
  return { ...preview(target), backupPath, warnings };
}
