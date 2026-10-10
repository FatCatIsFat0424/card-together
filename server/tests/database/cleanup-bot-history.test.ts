import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupBotHistory } from '../../src/database/cleanup-bot-history';
import { createJsonRepository } from '../../src/database/json-repository';
import { emptyDocument } from '../../src/database/schema';
import type { MatchRecord } from '../../src/database/repository';

describe('legacy bot history and offline cleanup', () => {
  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-bot-cleanup-'));
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
    document.matches = [human, { ...human, id: 'bot-match', finishedAt: 200,
      accountIds: ['alice', ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)] }];
    document.runtime = { players: [], rooms: [], games: [], chat: [] };
    await writeFile(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('loads legacy bot matches but excludes them before limiting human history', async () => {
    const repository = await createJsonRepository(path);
    try {
      expect((await repository.listMatches('alice', 1)).map((match) => match.id)).toEqual(['human-match']);
      expect(await repository.listMatches('alice', 0)).toEqual([]);
      expect(JSON.parse(await readFile(path, 'utf8')).matches).toHaveLength(2);
    } finally { await repository.close(); }
  });

  it('defaults to a read-only dry run', async () => {
    const original = await readFile(path, 'utf8');
    expect(await cleanupBotHistory(path)).toEqual({ removed: 1, remaining: 1, backupPath: null });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });

  it('requires explicit stopped-writer acknowledgement before applying from the CLI', async () => {
    const original = await readFile(path, 'utf8');
    const run = promisify(execFile);
    const args = [resolve('../node_modules/tsx/dist/cli.mjs'), resolve('src/database/cleanup-bot-history-cli.ts'), path];
    const preview = await run(process.execPath, args);
    expect(JSON.parse(preview.stdout)).toEqual({ mode: 'dry-run', removed: 1, remaining: 1, backupPath: null });
    await expect(run(process.execPath, [...args, '--apply'])).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('Stop all database writers'),
    });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });

  it('backs up the complete file and removes only bot history, with an idempotent second run', async () => {
    const original = await readFile(path, 'utf8');
    const result = await cleanupBotHistory(path, true);
    expect(result).toMatchObject({ removed: 1, remaining: 1, backupPath: expect.any(String) });
    expect(await readFile(result.backupPath!, 'utf8')).toBe(original);
    expect((await stat(result.backupPath!)).mode & 0o777).toBe(0o600);
    const cleaned = JSON.parse(await readFile(path, 'utf8'));
    const before = JSON.parse(original);
    expect(cleaned).toEqual({ ...before, matches: [before.matches[0]] });
    expect(await cleanupBotHistory(path, true)).toEqual({ removed: 0, remaining: 1, backupPath: null });
    const repository = await createJsonRepository(path);
    try {
      expect(await repository.loadRuntime()).toEqual(before.runtime);
      expect(await repository.listMatches('alice')).toEqual(cleaned.matches);
    } finally { await repository.close(); }
  });

  it('preserves invalid or incompatible files without creating backups', async () => {
    for (const contents of ['{', JSON.stringify({ schemaVersion: 999 }),
      JSON.stringify({ ...emptyDocument(), matches: [{ accountIds: ['bot:invalid'] }] })]) {
      await writeFile(path, contents);
      await expect(cleanupBotHistory(path, true)).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe(contents);
      expect(await readdir(directory)).toEqual(['database.json']);
    }
  });

  it.runIf(typeof process.getuid === 'function')('rejects applying under a different file owner', async () => {
    const original = await readFile(path, 'utf8');
    const owner = (await stat(path)).uid;
    vi.spyOn(process, 'getuid').mockReturnValue(owner + 1);
    expect(await cleanupBotHistory(path)).toMatchObject({ removed: 1, backupPath: null });
    await expect(cleanupBotHistory(path, true)).rejects.toThrow('database file owner');
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['database.json']);
  });
});
