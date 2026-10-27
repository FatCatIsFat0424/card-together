import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupMatchHistory } from '../../src/database/cleanup-match-history';
import { createJsonRepository } from '../../src/database/json-repository';
import { emptyDocument } from '../../src/database/schema';
import type { MatchRecord } from '../../src/database/repository';
import { acquireDatabaseLock } from '../../src/database/owner-lock';
import { importJsonDocument } from '../../src/database/sqlite-import';
import { createSqliteRepository } from '../../src/database/sqlite-repository';
import { SQLITE_ADAPTER } from '../helpers/repository-adapters';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, cp: vi.fn(original.cp), rename: vi.fn(original.rename) };
});

describe('match history retention and offline cleanup', () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-match-cleanup-'));
    path = join(directory, 'database.json');
    const document = emptyDocument();
    for (const id of ['alice', 'bravo', 'charlie', 'delta']) {
      document.accounts.push({
        id, username: id, usernameNormalized: id, nickname: id, color: '#123456', avatar: 'cat',
        avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
        cardBackOpacity: 100, matchesPublic: false, createdAt: 1, updatedAt: 1,
        passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
      });
    }
    const human: MatchRecord = {
      id: 'human-match', roomCode: 'ABC123', accountIds: ['alice', 'bravo', 'charlie', 'delta'], finishedAt: 100,
      result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
    };
    document.matches = [human, ...Array.from({ length: 102 }, (_, index) => ({
      ...human, id: `bot-match-${index}`, finishedAt: 200 + index,
      accountIds: ['alice', ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)],
    }))];
    document.runtime = { players: [], rooms: [], games: [], chat: [] };
    await writeFile(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('prunes old matches durably at startup and bounds shared history per account', async () => {
    const original = await readFile(path, 'utf8');
    const repository = await createJsonRepository(path);
    try {
      expect((await repository.listMatches('alice', 1)).map((match) => match.id)).toEqual(['bot-match-101']);
      expect(await repository.listMatches('alice')).toHaveLength(100);
      expect(await repository.listMatches('alice', 0)).toEqual([]);
      expect((await repository.listMatches('bravo')).map((match) => match.id)).toEqual(['human-match']);
      expect(JSON.parse(await readFile(path, 'utf8')).matches).toHaveLength(101);
      const backup = (await readdir(directory)).find((name) => name.endsWith('.bak'))!;
      expect(await readFile(join(directory, backup, 'database.json'), 'utf8')).toBe(original);
    } finally { await repository.close(); }
  });

  it('defaults to a read-only dry run', async () => {
    const original = await readFile(path, 'utf8');
    expect(await cleanupMatchHistory(path)).toEqual({ removed: 2, remaining: 101, backupPath: null });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });

  it('requires explicit stopped-writer acknowledgement before applying from the CLI', async () => {
    const original = await readFile(path, 'utf8');
    const run = promisify(execFile);
    const args = [resolve('../node_modules/tsx/dist/cli.mjs'), resolve('src/database/cleanup-match-history-cli.ts'), path];
    const preview = await run(process.execPath, args);
    expect(JSON.parse(preview.stdout)).toEqual({ mode: 'dry-run', removed: 2, remaining: 101, backupPath: null });
    await expect(run(process.execPath, [...args, '--apply'])).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('Stop all database writers'),
    });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });

  it('backs up the complete file and removes expired history and archives, with an idempotent second run', async () => {
    const original = await readFile(path, 'utf8');
    await mkdir(join(directory, 'replays'));
    await mkdir(join(directory, 'media'));
    await writeFile(join(directory, 'replays', 'bot-match-0.json'), 'private archive');
    await writeFile(join(directory, 'media', 'avatar.webp'), 'private media');
    const result = await cleanupMatchHistory(path, true);
    expect(result).toMatchObject({ removed: 2, remaining: 101, backupPath: expect.any(String) });
    expect(await readFile(join(result.backupPath!, 'database.json'), 'utf8')).toBe(original);
    expect((await stat(result.backupPath!)).mode & 0o777).toBe(0o700);
    expect((await stat(join(result.backupPath!, 'database.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(result.backupPath!, 'replays', 'bot-match-0.json'), 'utf8')).toBe('private archive');
    expect(await readFile(join(result.backupPath!, 'media', 'avatar.webp'), 'utf8')).toBe('private media');
    expect(await readdir(join(directory, 'replays'))).toEqual([]);
    const cleaned = JSON.parse(await readFile(path, 'utf8'));
    const before = JSON.parse(original);
    expect(cleaned).toEqual({ ...before, matches: [before.matches[0], ...before.matches.slice(3)] });
    expect(await cleanupMatchHistory(path, true)).toEqual({ removed: 0, remaining: 101, backupPath: null });
    const repository = await createJsonRepository(path);
    try {
      expect(await repository.loadRuntime()).toEqual(before.runtime);
      expect(await repository.listMatches('alice')).toEqual(cleaned.matches.slice(1).reverse());
    } finally { await repository.close(); }
  });

  it('leaves history and archives intact when startup persistence fails', async () => {
    const original = await readFile(path, 'utf8');
    await mkdir(join(directory, 'replays'));
    await writeFile(join(directory, 'replays', 'bot-match-0.json'), 'private archive');
    vi.mocked(rename).mockRejectedValueOnce(new Error('Disk full'));
    await expect(createJsonRepository(path)).rejects.toThrow('Disk full');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readFile(join(directory, 'replays', 'bot-match-0.json'), 'utf8')).toBe('private archive');
    const reopened = await createJsonRepository(path);
    await reopened.close();
    expect(await readdir(join(directory, 'replays'))).toEqual([]);
  });

  it('leaves the database intact if the complete backup or atomic replacement fails', async () => {
    const original = await readFile(path, 'utf8');
    await mkdir(join(directory, 'media'));
    await writeFile(join(directory, 'media', 'avatar.webp'), 'private media');
    vi.mocked(cp).mockRejectedValueOnce(new Error('Backup failed'));
    await expect(cleanupMatchHistory(path, true)).rejects.toThrow('Backup failed');
    expect(await readFile(path, 'utf8')).toBe(original);
    vi.mocked(rename).mockRejectedValueOnce(new Error('Write failed'));
    await expect(cleanupMatchHistory(path, true)).rejects.toThrow('Write failed');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('preserves invalid or incompatible files without creating backups', async () => {
    for (const contents of ['{', JSON.stringify({ schemaVersion: 999 }),
      JSON.stringify({ ...emptyDocument(), matches: [{ accountIds: ['bot:invalid'] }] })]) {
      await writeFile(path, contents);
      await expect(cleanupMatchHistory(path, true)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(contents);
      expect(await readdir(directory)).toEqual(['database.json']);
    }
  });

  it.runIf(typeof process.getuid === 'function')('rejects applying under a different file owner', async () => {
    const original = await readFile(path, 'utf8');
    const owner = (await stat(path)).uid;
    vi.spyOn(process, 'getuid').mockReturnValue(owner + 1);
    expect(await cleanupMatchHistory(path)).toMatchObject({ removed: 2, backupPath: null });
    await expect(cleanupMatchHistory(path, true)).rejects.toThrow('database file owner');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });
});

describe('offline match history cleanup on SQLite', () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-match-cleanup-sqlite-'));
    path = join(directory, 'database.sqlite');
    const document = emptyDocument();
    for (const id of ['alice', 'bravo']) {
      document.accounts.push({
        id, username: id, usernameNormalized: id, nickname: id, color: '#123456', avatar: 'cat',
        avatarImage: null, tableBackground: null, tableBackgroundOpacity: 100, cardBack: null,
        cardBackOpacity: 100, matchesPublic: false, createdAt: 1, updatedAt: 1,
        passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`,
      });
    }
    const human: MatchRecord = {
      id: 'human-match', roomCode: 'ABC123', accountIds: ['alice', 'bravo', `bot:${randomUUID()}`, `bot:${randomUUID()}`], finishedAt: 100,
      result: { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
        declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true },
    };
    document.matches = [human, ...Array.from({ length: 102 }, (_, index) => ({
      ...human, id: `bot-match-${index}`, finishedAt: 200 + index, hasReplay: index === 0 ? true : undefined,
      accountIds: ['alice', ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)],
    }))].map((match) => JSON.parse(JSON.stringify(match)) as MatchRecord);
    document.runtime = { players: [], rooms: [], games: [], chat: [] };
    await importJsonDocument(document, path);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function files(): Promise<string[]> {
    return (await readdir(directory)).filter((name) => !/-(?:wal|shm)$/.test(name)).sort();
  }

  it('previews without writing and refuses to apply while another process owns the database', async () => {
    const before = await SQLITE_ADAPTER.persisted(path);
    expect(await cleanupMatchHistory(path)).toEqual({ removed: 2, remaining: 101, backupPath: null });
    const run = promisify(execFile);
    const preview = await run(process.execPath, [resolve('../node_modules/tsx/dist/cli.mjs'),
      resolve('src/database/cleanup-match-history-cli.ts'), path]);
    expect(JSON.parse(preview.stdout)).toEqual({ mode: 'dry-run', removed: 2, remaining: 101, backupPath: null });
    const lock = await acquireDatabaseLock(path);
    try {
      await expect(cleanupMatchHistory(path, true)).rejects.toMatchObject({ code: 'DATABASE_IN_USE' });
    } finally { await lock.release(); }
    expect(await SQLITE_ADAPTER.persisted(path)).toBe(before);
    expect(await files()).toEqual(['database.sqlite']);
  });

  it('backs up the database, media, and replays, then removes expired history and archives once', async () => {
    const before = await SQLITE_ADAPTER.readDocument(path);
    await mkdir(join(directory, 'replays'));
    await mkdir(join(directory, 'media'));
    await writeFile(join(directory, 'replays', 'bot-match-0.json'), 'private archive');
    await writeFile(join(directory, 'media', 'avatar.webp'), 'private media');
    const result = await cleanupMatchHistory(path, true);
    expect(result).toMatchObject({ removed: 2, remaining: 101, backupPath: expect.any(String) });
    expect((await stat(result.backupPath!)).mode & 0o777).toBe(0o700);
    expect((await stat(join(result.backupPath!, 'database.sqlite'))).mode & 0o777).toBe(0o600);
    expect(await SQLITE_ADAPTER.readDocument(join(result.backupPath!, 'database.sqlite'))).toEqual(before);
    expect(await readFile(join(result.backupPath!, 'replays', 'bot-match-0.json'), 'utf8')).toBe('private archive');
    expect(await readFile(join(result.backupPath!, 'media', 'avatar.webp'), 'utf8')).toBe('private media');
    expect(await readdir(join(directory, 'replays'))).toEqual([]);
    const cleaned = await SQLITE_ADAPTER.readDocument(path);
    expect(cleaned).toEqual({ ...before, matches: [before.matches[0], ...before.matches.slice(3)] });
    expect(await cleanupMatchHistory(path, true)).toEqual({ removed: 0, remaining: 101, backupPath: null });
    expect((await files()).filter((name) => name.endsWith('.lock'))).toEqual([]);
    const repository = await createSqliteRepository(path);
    try {
      expect(await repository.loadRuntime()).toEqual(before.runtime);
      expect(await repository.listMatches('alice')).toEqual(cleaned.matches.slice(1).reverse());
    } finally { await repository.close(); }
  });
});
