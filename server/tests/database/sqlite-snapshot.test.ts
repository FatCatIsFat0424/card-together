import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { databaseLockPath } from '../../src/database/owner-lock';
import type { Repository } from '../../src/database/repository';
import { emptyDocument } from '../../src/database/schema';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import { snapshotSqliteDatabase, verifyDatabaseSnapshot } from '../../src/database/sqlite-snapshot';
import { SQLITE_ADAPTER } from '../helpers/repository-adapters';
import { account } from '../helpers/storage-fixture';

describe('SQLite snapshots for backup and restore', () => {
  let directory: string;
  let path: string;
  let snapshot: string;
  let repository: Repository | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-sqlite-snapshot-'));
    path = join(directory, 'database.sqlite');
    snapshot = join(directory, 'snapshot.sqlite');
  });

  afterEach(async () => {
    await repository?.close();
    repository = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('copies a database that a running server owns, then verifies the copy', async () => {
    repository = await createSqliteRepository(path);
    await repository.createAccount(account('alice'));
    await repository.saveRuntime({ players: [], rooms: [], games: [], chat: [] });
    const result = await snapshotSqliteDatabase(path, snapshot);
    expect(result).toMatchObject({
      path: snapshot, schemaVersion: 7, droppedRecordings: [],
      collections: expect.objectContaining({ accounts: 1, matches: 0 }),
      sqlite: { quickCheck: 'ok', foreignKeyViolations: 0, tables: expect.objectContaining({ accounts: 1, runtime_state: 1 }) },
    });
    // The server keeps its lock and connection; the copy is one private file.
    expect(JSON.parse(await readFile(databaseLockPath(path), 'utf8'))).toMatchObject({ pid: process.pid });
    expect((await stat(snapshot)).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).filter((name) => name.startsWith('snapshot'))).toEqual(['snapshot.sqlite']);
    const copy = new DatabaseSync(snapshot, { readOnly: true });
    try {
      expect(copy.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
    } finally { copy.close(); }
    await repository.createAccount(account('bravo'));
    expect((await SQLITE_ADAPTER.readDocument(snapshot)).accounts.map((entry) => entry.username)).toEqual(['alice']);
    await expect(snapshotSqliteDatabase(path, snapshot)).rejects.toThrow('already exists');
  });

  it('rejects damaged, foreign, and newer databases and removes a failed copy', async () => {
    await SQLITE_ADAPTER.seed(path, { ...emptyDocument(), accounts: [account('alice')] });
    expect((await verifyDatabaseSnapshot(path)).collections.accounts).toBe(1);
    const newer = new DatabaseSync(path);
    newer.exec('PRAGMA user_version = 99');
    newer.close();
    await expect(verifyDatabaseSnapshot(path)).rejects.toThrow('Unsupported database schema version: 99');
    await expect(snapshotSqliteDatabase(path, snapshot)).rejects.toThrow('Unsupported database schema version: 99');
    expect((await readdir(directory)).filter((name) => name.startsWith('snapshot'))).toEqual([]);
    const restored = new DatabaseSync(path);
    restored.exec('PRAGMA user_version = 7');
    restored.close();
    await snapshotSqliteDatabase(path, snapshot);
    // Keep the header page so the file still opens, and damage every table page after it.
    const size = (await stat(snapshot)).size;
    const handle = await open(snapshot, 'r+');
    await handle.write(Buffer.alloc(size - 4096, 0xab), 0, size - 4096, 4096);
    await handle.close();
    await expect(verifyDatabaseSnapshot(snapshot)).rejects.toThrow();
    const foreign = join(directory, 'foreign.sqlite');
    const other = new DatabaseSync(foreign);
    other.exec('CREATE TABLE notes (text TEXT)');
    other.close();
    await expect(verifyDatabaseSnapshot(foreign)).rejects.toThrow('not a Card Together database');
  });

  it('verifies JSON snapshots, including older schema versions that migrate at startup', async () => {
    const json = join(directory, 'database.json');
    await writeFile(json, JSON.stringify({ ...emptyDocument(), accounts: [account('alice')] }));
    expect(await verifyDatabaseSnapshot(json)).toMatchObject({ schemaVersion: 7, collections: expect.objectContaining({ accounts: 1 }) });
    await writeFile(json, JSON.stringify({ ...emptyDocument(), schemaVersion: 6 }));
    expect((await verifyDatabaseSnapshot(json)).schemaVersion).toBe(6);
    await writeFile(json, JSON.stringify({ schemaVersion: 99 }));
    await expect(verifyDatabaseSnapshot(json)).rejects.toThrow();
    await writeFile(json, '{');
    await expect(verifyDatabaseSnapshot(json)).rejects.toThrow('Invalid JSON database snapshot');
  });
});
