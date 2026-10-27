import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonRepository } from '../../src/database/json-repository';
import { CURRENT_SCHEMA_VERSION } from '../../src/database/migrations';
import type { AccountRecord, Repository } from '../../src/database/repository';
import type { DatabaseDocument } from '../../src/database/schema';
import { emptyDocument } from '../../src/database/schema';
import { importJsonDocument } from '../../src/database/sqlite-import';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import { SQLITE_APPLICATION_ID, SQLITE_BUSY_TIMEOUT_MS, openSqliteDatabase } from '../../src/database/sqlite-schema';
import * as chat from '../../src/managers/chat-manager';
import * as games from '../../src/managers/game-manager';
import * as players from '../../src/managers/player-manager';
import * as rooms from '../../src/managers/room-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { account, dtos, EMPTY_RUNTIME, match, NEW_HASH, PASSWORD_HASH, populate, resetRuntime } from '../helpers/storage-fixture';
import { SQLITE_ADAPTER } from '../helpers/repository-adapters';

function writeLog(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec('CREATE TABLE IF NOT EXISTS test_write_log (target TEXT NOT NULL)');
  for (const table of ['runtime_state', 'runtime_players', 'runtime_rooms', 'runtime_games', 'runtime_chat']) {
    for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
      database.exec(`CREATE TRIGGER IF NOT EXISTS log_${table}_${event} AFTER ${event} ON ${table}
        BEGIN INSERT INTO test_write_log (target) VALUES ('${table}'); END`);
    }
  }
  return database;
}

describe('SQLite repository', () => {
  let directory: string;
  let path: string;
  let repository: Repository | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-sqlite-'));
    path = join(directory, 'database.sqlite');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetRuntime();
    await repository?.close();
    repository = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('opens with WAL, full sync, foreign keys, a busy timeout, and the current schema version', async () => {
    const { database, previousVersion } = await openSqliteDatabase(path);
    try {
      expect(previousVersion).toBeNull();
      const pragma = (name: string): unknown => Object.values(database.prepare(`PRAGMA ${name}`).get()!)[0];
      expect(pragma('journal_mode')).toBe('wal');
      expect(pragma('synchronous')).toBe(2);
      expect(pragma('foreign_keys')).toBe(1);
      expect(pragma('busy_timeout')).toBe(SQLITE_BUSY_TIMEOUT_MS);
      expect(pragma('application_id')).toBe(SQLITE_APPLICATION_ID);
      expect(pragma('user_version')).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      database.close();
    }
    const reopened = await openSqliteDatabase(path);
    expect(reopened.previousVersion).toBe(CURRENT_SCHEMA_VERSION);
    reopened.database.close();
    // Password hashes and private hands stay owner-only, like the JSON file.
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('refuses other files and versions without modifying them', async () => {
    await writeFile(path, JSON.stringify(emptyDocument()));
    await expect(createSqliteRepository(path)).rejects.toThrow('file is not a database');
    expect(await readFile(path, 'utf8')).toBe(JSON.stringify(emptyDocument()));
    await rm(path);

    const foreign = new DatabaseSync(path);
    foreign.exec('CREATE TABLE notes (body TEXT)');
    foreign.close();
    const before = await readFile(path);
    await expect(createSqliteRepository(path)).rejects.toThrow('not a Card Together database');
    expect(await readFile(path)).toEqual(before);
    await rm(path);

    (await openSqliteDatabase(path)).database.close();
    const newer = new DatabaseSync(path);
    newer.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION + 1}`);
    newer.close();
    await expect(createSqliteRepository(path)).rejects.toThrow('Unsupported database schema version');
    // The same process cannot open one database twice.
    await rm(path);
    repository = await createSqliteRepository(path);
    await expect(createSqliteRepository(path)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    await expect(importJsonDocument(emptyDocument(), path)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
  });

  it('enforces unique usernames under concurrent registration and in the schema itself', async () => {
    repository = await createSqliteRepository(path);
    const results = await Promise.allSettled(['Alice', 'alice', 'ALICE'].map((name) => repository!.createAccount(account(name))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result as PromiseRejectedResult).reason))
      .toEqual([expect.objectContaining({ code: 'USERNAME_EXISTS' }), expect.objectContaining({ code: 'USERNAME_EXISTS' })]);
    // Another connection that skipped the repository check still cannot insert a duplicate.
    const other = new DatabaseSync(path);
    try {
      expect(() => other.prepare('INSERT INTO accounts (id, username_normalized, nickname_search, password_hash, record) VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), 'alice', 'alice', PASSWORD_HASH, '{}')).toThrow('UNIQUE constraint failed');
      expect(() => other.prepare("INSERT INTO friendships (id, requester_id, recipient_id, pair, status, created_at, updated_at) VALUES ('f', 'x', 'y', 'p', 'pending', 1, 1)")
        .run()).toThrow('FOREIGN KEY constraint failed');
    } finally {
      other.close();
    }
  });

  it('changes a password only for the expected hash and revokes sessions in the same transaction', async () => {
    repository = await createSqliteRepository(path);
    const alice = await repository.createAccount(account('alice'));
    const session = { tokenHash: 'ab'.repeat(32), accountId: alice.id, createdAt: 100, expiresAt: 1000 };
    expect(await repository.createSession(session, PASSWORD_HASH)).toBe(true);
    const third = PASSWORD_HASH.replace('ab'.repeat(16), '34'.repeat(16));
    const results = await Promise.all([
      repository.changePassword(alice.id, PASSWORD_HASH, NEW_HASH, 200),
      repository.changePassword(alice.id, PASSWORD_HASH, third, 201),
      repository.createSession({ ...session, tokenHash: 'cd'.repeat(32) }, PASSWORD_HASH),
    ]);
    expect(results).toEqual([true, false, false]);
    expect((await repository.getAccountById(alice.id))?.passwordHash).toBe(NEW_HASH);
    expect(await repository.getSession(session.tokenHash)).toBeNull();

    // A failed commit keeps the old hash and its sessions.
    expect(await repository.createSession(session, NEW_HASH)).toBe(true);
    SQLITE_ADAPTER.failNextCommit(new Error('Disk full'));
    await expect(repository.changePassword(alice.id, NEW_HASH, third, 300)).rejects.toThrow('Disk full');
    expect((await repository.getAccountById(alice.id))?.passwordHash).toBe(NEW_HASH);
    expect(await repository.getSession(session.tokenHash)).toEqual(session);
    await repository.close();
    repository = await createSqliteRepository(path);
    expect((await repository.getAccountByUsername('alice'))?.passwordHash).toBe(NEW_HASH);
    expect(await repository.getSession(session.tokenHash)).toEqual(session);
  });

  it('rolls back a transaction that fails midway and restores runtime memory', async () => {
    let now = 1_000;
    repository = await createSqliteRepository(path, { now: () => now });
    const accounts = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    for (const entry of accounts) await repository.createAccount(entry);
    const runtime = await createRuntimeCoordinator(repository);
    await runtime.mutate(() => players.attachPlayer('alice-socket', players.toPlayerInfo(accounts[0])));
    const committed = runtime.snapshot();
    now = 2_000;
    // Last-seen times are written before the match fails its reference check in the same transaction.
    const unknown = match('broken', [accounts[0].id, randomUUID(), accounts[2].id, accounts[3].id], 500);
    await expect(repository.saveRuntime(runtime.snapshot(), [unknown])).rejects.toThrow('invalid references');
    expect((await repository.getAccountById(accounts[0].id))?.lastSeenAt).toBe(1_000);
    expect(await repository.listMatches(accounts[0].id)).toEqual([]);

    // A coordinator mutation whose commit fails restores its in-memory state.
    SQLITE_ADAPTER.failNextCommit(new Error('Disk full'));
    await expect(runtime.mutate(() => players.updatePlayerInfo({ ...players.toPlayerInfo(accounts[0]), nickname: 'Lost' })))
      .rejects.toThrow('Disk full');
    expect(runtime.snapshot()).toEqual(committed);
    expect(await repository.loadRuntime()).toEqual(committed);
    // The adapter's record of committed rows did not advance, so the retry writes the row again.
    await runtime.mutate(() => players.updatePlayerInfo({ ...players.toPlayerInfo(accounts[0]), nickname: 'Kept' }));
    await repository.close();
    repository = await createSqliteRepository(path, { now: () => now });
    expect((await repository.loadRuntime())?.players[0].info.nickname).toBe('Kept');
    expect((await repository.getAccountById(accounts[0].id))?.lastSeenAt).toBe(2_000);
  });

  it('commits runtime, completed matches, receipts, and coins atomically', async () => {
    repository = await createSqliteRepository(path);
    const accounts = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    for (const entry of accounts) await repository.createAccount(entry);
    const snapshot = { ...EMPTY_RUNTIME, players: [{ info: players.toPlayerInfo(accounts[0]), currentRoomCode: null,
      disconnectedAt: 900 }] };
    const completed = match('atomic', accounts.map((entry) => entry.id), 500);
    SQLITE_ADAPTER.failNextCommit(new Error('Disk full'));
    await expect(repository.saveRuntime(snapshot, [completed])).rejects.toThrow('Disk full');
    expect(await repository.loadRuntime()).toBeNull();
    expect(await repository.listMatches(accounts[0].id)).toEqual([]);
    expect(await repository.getAccountById(accounts[0].id)).not.toHaveProperty('lastSeenAt');
    expect(await SQLITE_ADAPTER.persisted(path)).not.toContain('atomic');
    await repository.saveRuntime(snapshot, [completed]);
    const stored = await SQLITE_ADAPTER.readDocument(path);
    expect(stored.runtime).toEqual(snapshot);
    expect(stored.matches).toEqual([completed]);
    expect(stored.accounts[0].lastSeenAt).toBe(900);
  });

  it('writes only the runtime rows a mutation changed', async () => {
    repository = await createSqliteRepository(path);
    const [alice, bob] = ['alice', 'bob'].map(account);
    for (const entry of [alice, bob]) await repository.createAccount(entry);
    const runtime = await createRuntimeCoordinator(repository);
    const codes: string[] = [];
    await runtime.mutate(() => {
      for (const entry of [alice, bob]) {
        const info = players.toPlayerInfo(entry);
        players.attachPlayer(`${entry.username}-socket`, info);
        const code = rooms.createRoom('bridge', entry.id);
        players.setPlayerRoom(entry.id, code);
        rooms.changeSeat(code, info, 'N');
        chat.initRoomChat(code);
        codes.push(code);
      }
    });
    const log = writeLog(path);
    try {
      await runtime.mutate(() => { chat.addMessage(codes[0], players.toPlayerInfo(alice), 'hello'); });
      expect(log.prepare('SELECT target FROM test_write_log').all().map((row) => row.target)).toEqual(['runtime_chat']);
      log.exec('DELETE FROM test_write_log');
      await runtime.mutate(() => { rooms.setReady(codes[1], bob.id, true); });
      expect(log.prepare('SELECT target FROM test_write_log').all().map((row) => row.target)).toEqual(['runtime_rooms']);
    } finally {
      log.close();
    }
    expect(await repository.loadRuntime()).toEqual(runtime.snapshot());
  });

  it('re-validates changed games and the links of unchanged ones on every runtime write', async () => {
    repository = await createSqliteRepository(path);
    const alice = await repository.createAccount(account('alice'));
    const runtime = await createRuntimeCoordinator(repository);
    let code = '';
    await runtime.mutate(() => {
      const human = players.toPlayerInfo(alice);
      players.attachPlayer('alice-socket', human);
      code = rooms.createRoom('redpoints', alice.id);
      players.setPlayerRoom(alice.id, code);
      rooms.changeSeat(code, human, 'N');
      rooms.fillBots(code, alice.id);
      rooms.setReady(code, alice.id, true);
      rooms.setRoomStatus(code, 'playing');
      games.startGame(code, 'redpoints', rooms.getSeatPlayers(code)!);
    });
    const committed = runtime.snapshot();
    const changedGame = structuredClone(committed);
    Object.assign(changedGame.games[0], { currentTurnSeat: 'X' });
    await expect(repository.saveRuntime(changedGame)).rejects.toThrow('schema');
    // The game row is unchanged, but a playing game in a waiting room is still inconsistent.
    const changedRoom = structuredClone(committed);
    changedRoom.rooms[0].info = { ...changedRoom.rooms[0].info, status: 'waiting' };
    await expect(repository.saveRuntime(changedRoom)).rejects.toThrow('schema');
    expect(await repository.loadRuntime()).toEqual(committed);
  });

  it('prunes history at startup only after backing up the database, media, and replays', async () => {
    const accounts = ['alice', 'bravo', 'charlie', 'delta'].map(account);
    const ids = accounts.map((entry) => entry.id);
    await importJsonDocument({ ...emptyDocument(), accounts,
      matches: Array.from({ length: 102 }, (_, index) => match(`m${index}`, ids, index)) }, path);
    repository = await createSqliteRepository(path);
    expect((await repository.listMatches(ids[0])).map((entry) => entry.id))
      .toEqual(Array.from({ length: 100 }, (_, index) => `m${101 - index}`));
    const backups = (await readdir(directory)).filter((name) => name.startsWith('database.sqlite.match-history-'));
    expect(backups).toHaveLength(1);
    expect(await readdir(join(directory, backups[0]))).toEqual(['database.sqlite']);
    expect((await SQLITE_ADAPTER.readDocument(join(directory, backups[0], 'database.sqlite'))).matches).toHaveLength(102);
    expect((await SQLITE_ADAPTER.readDocument(path)).matches).toHaveLength(100);
  });

  describe('JSON import', () => {
    let jsonPath: string;
    let source: DatabaseDocument;
    let accounts: AccountRecord[];

    beforeEach(async () => {
      jsonPath = join(directory, 'database.json');
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_700_000_000_000);
      const json = await createJsonRepository(jsonPath);
      try {
        accounts = await populate(json);
      } finally {
        await json.close();
      }
      resetRuntime();
      source = JSON.parse(await readFile(jsonPath, 'utf8')) as DatabaseDocument;
    });

    it('round-trips every record and reads back the same DTOs as the JSON repository', async () => {
      expect(source.runtime?.games).toHaveLength(1);
      expect(source.runtime?.chat.some((entry) => entry.messages.length > 0)).toBe(true);
      expect(source.matches.some((entry) => entry.hasReplay)).toBe(true);
      expect(source.rewardedGameIds).toHaveLength(1);
      const result = await importJsonDocument(source, path);
      expect(result).toEqual({ runtime: true, droppedRecordings: [], imported: {
        accounts: 3, sessions: 1, friendships: 2, matches: 2, emojis: 1, directMessages: 1, messageReads: 1,
        friendNotifications: 1, rewardedGameIds: 1 } });
      expect(await SQLITE_ADAPTER.readDocument(path)).toEqual(source);
      const json = await createJsonRepository(jsonPath);
      try {
        repository = await createSqliteRepository(path);
        expect(await dtos(repository, accounts)).toEqual(await dtos(json, accounts));
      } finally {
        await json.close();
      }
    });

    it('imports older schema versions through the JSON migrations', async () => {
      const older = { ...structuredClone(source), schemaVersion: 6 } as unknown as DatabaseDocument;
      await importJsonDocument(older, path);
      expect((await SQLITE_ADAPTER.readDocument(path)).accounts.map((entry) => entry.id)).toEqual(accounts.map((entry) => entry.id));
    });

    it('refuses conflicts without changing the target', async () => {
      await importJsonDocument(source, path);
      const imported = await SQLITE_ADAPTER.persisted(path);
      await expect(importJsonDocument(source, path)).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
      const renamed = { ...account('ALICE'), id: randomUUID() };
      await expect(importJsonDocument({ ...emptyDocument(), accounts: [renamed] }, path))
        .rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
      const other = account('zed');
      await expect(importJsonDocument({ ...emptyDocument(), accounts: [other], runtime: { ...EMPTY_RUNTIME } }, path))
        .rejects.toMatchObject({ code: 'IMPORT_CONFLICT' });
      expect(await SQLITE_ADAPTER.persisted(path)).toBe(imported);
      // Invalid sources are refused before the target is touched.
      await expect(importJsonDocument({ ...emptyDocument(), accounts: [{ ...other, color: 'red' }] }, path)).rejects.toThrow('schema');
      // Unrelated records merge without replacing anything.
      await importJsonDocument({ ...emptyDocument(), accounts: [other] }, path);
      expect((await SQLITE_ADAPTER.readDocument(path)).accounts.map((entry) => entry.username))
        .toEqual(['alice', 'Bob', 'carol', 'zed']);
    });
  });
});
