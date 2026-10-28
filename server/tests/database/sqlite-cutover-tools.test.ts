import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportSqliteToJson, previewJsonExport } from '../../src/database/export-sqlite';
import { CURRENT_SCHEMA_VERSION } from '../../src/database/migrations';
import { createJsonRepository } from '../../src/database/json-repository';
import { migrateJsonToSqlite, previewSqliteMigration } from '../../src/database/migrate-sqlite';
import type { AccountRecord } from '../../src/database/repository';
import type { DatabaseDocument } from '../../src/database/schema';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import { SQLITE_ADAPTER } from '../helpers/repository-adapters';
import { dtos, populate, resetRuntime } from '../helpers/storage-fixture';

const run = promisify(execFile);
const COLLECTIONS = {
  accounts: 3, sessions: 1, friendships: 2, matches: 2, emojis: 1, directMessages: 1, messageReads: 1,
  friendNotifications: 1, rewardedGameIds: 1, gameStats: 1, accountStats: 1,
};

function cli(script: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return run(process.execPath, [resolve('../node_modules/tsx/dist/cli.mjs'), resolve(`src/database/${script}`), ...args]);
}

describe('SQLite cutover tools', () => {
  let directory: string;
  let jsonPath: string;
  let sqlitePath: string;
  let source: Buffer;
  let document: DatabaseDocument;
  let accounts: AccountRecord[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-sqlite-cutover-'));
    jsonPath = join(directory, 'database.json');
    sqlitePath = join(directory, 'database.sqlite');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const json = await createJsonRepository(jsonPath);
    try {
      accounts = await populate(json);
    } finally {
      await json.close();
    }
    resetRuntime();
    source = await readFile(jsonPath);
    document = JSON.parse(source.toString('utf8')) as DatabaseDocument;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetRuntime();
    await rm(directory, { recursive: true, force: true });
  });

  /** Database files, without replays/ and the journal files that read-only test connections leave behind. */
  async function files(): Promise<string[]> {
    return (await readdir(directory)).filter((name) => name !== 'replays' && !/-(?:wal|shm)$/.test(name)).sort();
  }

  async function expectSourceUntouched(): Promise<void> {
    expect((await readFile(jsonPath)).equals(source)).toBe(true);
  }

  describe('migration', () => {
    it('previews counts without writing anything', async () => {
      const preview = await previewSqliteMigration(jsonPath, sqlitePath);
      expect(preview).toMatchObject({
        source: jsonPath, target: sqlitePath, sourceSchemaVersion: CURRENT_SCHEMA_VERSION, collections: COLLECTIONS, runtime: true,
        droppedRecordings: [], sourceBytes: source.length, requiredBytes: source.length * 5,
      });
      expect(preview.availableBytes).toBeGreaterThan(0);
      const printed = JSON.parse((await cli('migrate-sqlite-cli.ts', jsonPath, sqlitePath)).stdout) as Record<string, unknown>;
      expect(printed).toMatchObject({ mode: 'dry-run', collections: COLLECTIONS });
      await expectSourceUntouched();
      expect(await files()).toEqual(['database.json']);
    });

    it('imports, verifies, and leaves the JSON database unchanged', async () => {
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: false })).rejects.toThrow('Stop all database writers');
      const result = await migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true });
      expect(result).toMatchObject({ collections: COLLECTIONS, runtime: true, verification: {
        quickCheck: 'ok', foreignKeyViolations: 0, countsMatch: true, readBack: true,
        tables: expect.objectContaining({ accounts: 3, matches: 2, match_participants: expect.any(Number), runtime_games: 1 }),
      } });
      expect(result.targetBytes).toBeGreaterThan(0);
      await expectSourceUntouched();
      expect((await stat(sqlitePath)).mode & 0o777).toBe(0o600);
      expect((await files()).filter((name) => name.includes('.lock') || name.endsWith('.tmp'))).toEqual([]);
      expect(await SQLITE_ADAPTER.readDocument(sqlitePath)).toEqual(document);
      const json = await createJsonRepository(jsonPath);
      try {
        const sqlite = await createSqliteRepository(sqlitePath);
        try {
          expect(await dtos(sqlite, accounts)).toEqual(await dtos(json, accounts));
        } finally { await sqlite.close(); }
      } finally { await json.close(); }
      // A second run never merges into the migrated database.
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('empty regular file');
    });

    it('refuses unsafe sources and targets without creating the target', async () => {
      const repository = await createJsonRepository(jsonPath);
      try {
        await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
      } finally { await repository.close(); }
      const other = join(directory, 'other');
      await mkdir(other);
      await expect(previewSqliteMigration(jsonPath, join(other, 'database.sqlite'))).rejects.toThrow('same directory');
      await expect(previewSqliteMigration(jsonPath, join(directory, 'database.db'))).rejects.toThrow('.json or .sqlite');
      await writeFile(join(directory, 'database.sqlite-wal'), 'old journal');
      await expect(previewSqliteMigration(jsonPath, sqlitePath)).rejects.toThrow('database.sqlite-wal');
      await rm(join(directory, 'database.sqlite-wal'));
      await writeFile(sqlitePath, 'not empty');
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('empty regular file');
      expect(await readFile(sqlitePath, 'utf8')).toBe('not empty');
      await rm(sqlitePath);
      await symlink(join(other, 'database.sqlite'), sqlitePath);
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('empty regular file');
      await rm(sqlitePath);
      const alias = join(directory, 'alias.json');
      await symlink(jsonPath, alias);
      await expect(previewSqliteMigration(alias, sqlitePath)).rejects.toThrow();
      await rm(alias);
      if (typeof process.getuid === 'function') {
        vi.spyOn(process, 'getuid').mockReturnValue((await stat(jsonPath)).uid + 1);
        await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('database file owner');
        vi.restoreAllMocks();
      }
      await expectSourceUntouched();
      expect(await readdir(other)).toEqual([]);
      await rm(other, { recursive: true });
      expect(await files()).toEqual(['database.json']);
    });

    it('removes a partial target when the import fails and keeps an empty target empty', async () => {
      await writeFile(sqlitePath, '');
      SQLITE_ADAPTER.failNextCommit(new Error('disk full'));
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('disk full');
      expect((await stat(sqlitePath)).size).toBe(0);
      expect(await files()).toEqual(['database.json', 'database.sqlite']);
      await rm(sqlitePath);
      SQLITE_ADAPTER.failNextCommit(new Error('disk full'));
      await expect(migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).rejects.toThrow('disk full');
      expect(await files()).toEqual(['database.json']);
      await expectSourceUntouched();
      expect((await migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true })).verification.countsMatch).toBe(true);
    });

    it('requires both apply acknowledgements on the command line', async () => {
      await expect(cli('migrate-sqlite-cli.ts', jsonPath, sqlitePath, '--apply')).rejects.toMatchObject({
        code: 1, stdout: '', stderr: expect.stringContaining('Stop all database writers'),
      });
      await expect(cli('migrate-sqlite-cli.ts', jsonPath)).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Usage') });
      const applied = JSON.parse((await cli('migrate-sqlite-cli.ts', jsonPath, sqlitePath, '--apply', '--writers-stopped')).stdout) as Record<string, unknown>;
      expect(applied).toMatchObject({ mode: 'applied', verification: { quickCheck: 'ok', countsMatch: true } });
      await expectSourceUntouched();
    });
  });

  describe('rollback export', () => {
    let exportPath: string;

    beforeEach(async () => {
      await migrateJsonToSqlite(jsonPath, sqlitePath, { writersStopped: true });
      exportPath = join(directory, 'database.export.json');
    });

    it('previews, then writes a validated JSON database the JSON adapter serves identically', async () => {
      // The SQLite database moves on after the cutover; the export must carry the newer writes.
      const sqlite = await createSqliteRepository(sqlitePath);
      try {
        await sqlite.updateProfile(accounts[2].id, { nickname: 'Renamed' }, Date.now());
      } finally { await sqlite.close(); }
      const expected = await SQLITE_ADAPTER.readDocument(sqlitePath);
      const preview = await previewJsonExport(sqlitePath, exportPath);
      expect(preview).toMatchObject({ source: sqlitePath, target: exportPath, collections: COLLECTIONS, runtime: true });
      expect(await files()).not.toContain('database.export.json');
      await expect(exportSqliteToJson(sqlitePath, exportPath, { writersStopped: false })).rejects.toThrow('Stop all database writers');

      const result = await exportSqliteToJson(sqlitePath, exportPath, { writersStopped: true });
      expect(result).toMatchObject({ validated: true, collections: COLLECTIONS, targetBytes: (await stat(exportPath)).size });
      expect((await stat(exportPath)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(expected);
      expect((await files()).filter((name) => name.includes('.lock') || name.endsWith('.tmp'))).toEqual([]);
      const exported = await createJsonRepository(exportPath);
      try {
        const reopened = await createSqliteRepository(sqlitePath);
        try {
          expect(await dtos(exported, accounts)).toEqual(await dtos(reopened, accounts));
          expect((await exported.getAccountById(accounts[2].id))?.nickname).toBe('Renamed');
        } finally { await reopened.close(); }
      } finally { await exported.close(); }
    });

    it('never overwrites, and refuses while the SQLite database is owned', async () => {
      await expect(previewJsonExport(sqlitePath, jsonPath)).rejects.toThrow('already exists');
      await expect(exportSqliteToJson(sqlitePath, jsonPath, { writersStopped: true })).rejects.toThrow('already exists');
      await expectSourceUntouched();
      const repository = await createSqliteRepository(sqlitePath);
      try {
        await expect(exportSqliteToJson(sqlitePath, exportPath, { writersStopped: true })).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
      } finally { await repository.close(); }
      const foreign = join(directory, 'foreign.sqlite');
      const other = new DatabaseSync(foreign);
      other.exec('CREATE TABLE notes (text TEXT)');
      other.close();
      await expect(previewJsonExport(foreign, exportPath)).rejects.toThrow('not a Card Together database');
      expect(await files()).toEqual(['database.json', 'database.sqlite', 'foreign.sqlite']);
    });

    it('exports through the command line', async () => {
      const preview = JSON.parse((await cli('export-sqlite-cli.ts', sqlitePath, exportPath)).stdout) as Record<string, unknown>;
      expect(preview).toMatchObject({ mode: 'dry-run', collections: COLLECTIONS });
      await expect(cli('export-sqlite-cli.ts', sqlitePath, exportPath, '--apply')).rejects.toMatchObject({ code: 1 });
      const applied = JSON.parse((await cli('export-sqlite-cli.ts', sqlitePath, exportPath, '--apply', '--writers-stopped')).stdout) as Record<string, unknown>;
      expect(applied).toMatchObject({ mode: 'applied', validated: true });
      expect(JSON.parse(await readFile(exportPath, 'utf8'))).toEqual(await SQLITE_ADAPTER.readDocument(sqlitePath));
    });
  });
});
