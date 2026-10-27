import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { isUsername } from '@shared/constants';
import { validateDocument } from '../database/schema';
import type { DatabaseDocument } from '../database/schema';
import type { AccountRecord } from '../database/repository';
import {
  assertDatabaseOwner, engineForPath, readDatabaseFile, resolveDatabasePath, statDatabaseFile,
} from '../database/offline-database';
import { acquireDatabaseLock } from '../database/owner-lock';
import { copySqliteDatabase, inTransaction, openCurrentSqliteDatabase, sqliteDataVersion } from '../database/sqlite-schema';
import type { Statements } from '../database/sqlite-store';
import { createStatements, integerColumn, readAccountByUsername, readDocument, updateAccount } from '../database/sqlite-store';
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

export interface PasswordResetOptions {
  readonly writersStopped: boolean;
  readonly expectedAccountId?: string;
  readonly now?: () => number;
}

interface JsonTarget {
  readonly path: string;
  readonly source: Stats;
  readonly original: Buffer;
  readonly document: DatabaseDocument;
  readonly index: number;
  readonly account: AccountRecord;
}

function normalizedUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!isUsername(normalized)) throw new Error('Enter a valid account username, not a nickname or account ID.');
  return normalized;
}

function accountNotFound(): Error {
  return new Error('Account not found. Use its username, not its nickname.');
}

async function readJsonTarget(path: string, normalized: string): Promise<JsonTarget> {
  const { stats: source, contents: original } = await readDatabaseFile(path);
  let document: unknown;
  try {
    document = JSON.parse(original.toString('utf8'));
  } catch {
    throw new Error('Invalid JSON database; the original file was preserved.');
  }
  validateDocument(document);
  const index = document.accounts.findIndex((account) => account.usernameNormalized === normalized);
  if (index < 0) throw accountNotFound();
  return { path, source, original, document, index, account: document.accounts[index] };
}

function jsonPreview(target: JsonTarget): PasswordResetPreview {
  return {
    databasePath: target.path,
    accountId: target.account.id,
    username: target.account.username,
    sessionsRevoked: target.document.sessions.filter((session) => session.accountId === target.account.id).length,
  };
}

/** Validates the whole database like a server start, then finds the account. */
function readSqliteTarget(sql: Statements, path: string, normalized: string): { account: AccountRecord; preview: PasswordResetPreview } {
  validateDocument(readDocument(sql));
  const account = readAccountByUsername(sql, normalized);
  if (!account) throw accountNotFound();
  const sessions = sql('SELECT COUNT(*) AS count FROM sessions WHERE account_id = ?').get(account.id);
  return {
    account,
    preview: { databasePath: path, accountId: account.id, username: account.username,
      sessionsRevoked: sessions ? integerColumn(sessions, 'count') : 0 },
  };
}

async function inspectSqlite(path: string, normalized: string): Promise<PasswordResetPreview> {
  await statDatabaseFile(path);
  const database = openCurrentSqliteDatabase(path);
  try {
    return readSqliteTarget(createStatements(database), path, normalized).preview;
  } finally {
    database.close();
  }
}

/** Read-only: reports the account and how many sessions a reset would revoke. */
export async function inspectPasswordReset(filePath: string, username: string): Promise<PasswordResetPreview> {
  const path = await resolveDatabasePath(filePath);
  const engine = engineForPath(path);
  const normalized = normalizedUsername(username);
  return engine === 'sqlite' ? inspectSqlite(path, normalized) : jsonPreview(await readJsonTarget(path, normalized));
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

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function resetJson(
  path: string, normalized: string, password: string, options: PasswordResetOptions, backupPath: string, warnings: string[],
): Promise<PasswordResetPreview> {
  const target = await readJsonTarget(path, normalized);
  if (options.expectedAccountId !== undefined && target.account.id !== options.expectedAccountId) {
    throw new Error('The target account changed after preview; no reset was applied.');
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
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
    // Writers that predate the lock file are detected by a change to the file itself.
    const current = await readJsonTarget(path, normalized);
    if (current.source.dev !== target.source.dev || current.source.ino !== target.source.ino
      || !current.original.equals(target.original)) {
      throw new Error(`Database changed during reset; no reset was applied. Backup: ${backupPath}`);
    }
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!hasCode(error, 'ENOENT')) warnings.push(`Unable to remove temporary file: ${temporaryPath}`);
    });
  }
  return jsonPreview(target);
}

async function resetSqlite(
  path: string, normalized: string, password: string, options: PasswordResetOptions, backupPath: string,
): Promise<PasswordResetPreview> {
  await statDatabaseFile(path);
  const database = openCurrentSqliteDatabase(path, { write: true });
  try {
    const sql = createStatements(database);
    const { account, preview } = readSqliteTarget(sql, path, normalized);
    const version = sqliteDataVersion(database);
    if (options.expectedAccountId !== undefined && account.id !== options.expectedAccountId) {
      throw new Error('The target account changed after preview; no reset was applied.');
    }
    const passwordHash = await hashPassword(password);
    const now = (options.now ?? Date.now)();
    await copySqliteDatabase(database, backupPath);
    inTransaction(database, () => {
      // Any commit by another connection since the target was read changes data_version.
      if (sqliteDataVersion(database) !== version) {
        throw new Error(`Database changed during reset; no reset was applied. Backup: ${backupPath}`);
      }
      updateAccount(sql, { ...account, passwordHash, updatedAt: Math.max(now, account.updatedAt + 1) });
      sql('DELETE FROM sessions WHERE account_id = ?').run(account.id);
    });
    return preview;
  } finally {
    database.close();
  }
}

/** Offline only: the database lock refuses running servers, and the backup keeps the previous state. */
export async function resetAccountPassword(
  filePath: string,
  username: string,
  newPassword: string,
  options: PasswordResetOptions,
): Promise<PasswordResetResult> {
  if (!options.writersStopped) throw new Error('Stop all database writers before resetting a password.');
  const password = validateNewPassword(newPassword);
  const path = await resolveDatabasePath(filePath);
  const engine = engineForPath(path);
  const normalized = normalizedUsername(username);
  assertDatabaseOwner(await statDatabaseFile(path), 'password reset');
  const lock = await acquireDatabaseLock(path);
  const backupPath = `${path}.password-reset-${randomUUID()}.bak`;
  const warnings: string[] = [];
  let failure: { readonly error: unknown } | undefined;
  let preview: PasswordResetPreview | undefined;
  try {
    preview = engine === 'sqlite'
      ? await resetSqlite(path, normalized, password, options, backupPath)
      : await resetJson(path, normalized, password, options, backupPath, warnings);
  } catch (error) {
    failure = { error };
  } finally {
    await lock.release().catch(() => warnings.push(`Unable to remove the database lock: ${lock.path}`));
  }
  if (failure) {
    if (warnings.length) throw new Error(`Reset was not applied. Cleanup needs attention: ${warnings.join(' ')}`, { cause: failure.error });
    throw failure.error;
  }
  if (!preview) throw new Error('Password reset did not complete.');
  return { ...preview, backupPath, warnings };
}
