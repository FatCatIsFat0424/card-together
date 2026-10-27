import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyReplayPatch } from '@shared/replay-patch';
import type { MatchReplay, ReplaySnapshot } from '@shared/types';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { createReplayStore } from '../../src/database/replay-store';
import { MAX_MATCHES_PER_ACCOUNT } from '../../src/database/repository';
import type { AccountRecord, MatchRecord, NewMatchRecord, Repository } from '../../src/database/repository';
import { emptyDocument, validateDocument } from '../../src/database/schema';
import type { RuntimeSnapshot } from '../../src/runtime/types';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rename: vi.fn(original.rename) };
});

vi.mock('@shared/replay-patch', async (importOriginal) => {
  const original = await importOriginal<typeof import('@shared/replay-patch')>();
  return { ...original, applyReplayPatch: vi.fn(original.applyReplayPatch) };
});

const RESULT: MatchRecord['result'] = { gameType: 'bridge', contract: { level: 1, suit: 'nt', declarer: 'N' },
  declarerTeamTricks: 7, defenderTeamTricks: 6, requiredTricks: 7, declarerTeamWins: true };

function account(id: string): AccountRecord {
  return {
    id, username: `player_${id}`, usernameNormalized: `player_${id}`, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
    tableBackground: null, tableBackgroundOpacity: 100, cardBack: null, cardBackOpacity: 100, matchesPublic: false,
    passwordHash: `scrypt$131072$8$1$${'ab'.repeat(16)}$${'cd'.repeat(64)}`, createdAt: 1, updatedAt: 1,
  };
}

function archive(phase = 'scoring'): MatchReplay {
  return { version: 1, gameType: 'bridge', startedAt: 10,
    initial: { gameType: 'bridge', phase: 'playing', log: [] } as unknown as ReplaySnapshot,
    steps: [[{ op: 'set', path: ['phase'], value: phase }]] };
}

function match(id: string, accountIds: readonly string[], finishedAt: number, replay: MatchReplay | null = archive()): NewMatchRecord {
  return { id, roomCode: 'ABC123', accountIds, result: RESULT, finishedAt, ...(replay ? { replay } : {}) };
}

describe.each(REPOSITORY_ADAPTERS)('replay archive storage ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let replays: string;
  let repository: Repository | undefined;

  async function open(): Promise<Repository> {
    repository = await adapter.open(path);
    return repository;
  }

  async function reopen(): Promise<Repository> {
    await repository?.close();
    return open();
  }

  async function storedFiles(): Promise<string[]> {
    return (await readdir(replays).catch(() => [])).sort();
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'card-replay-store-'));
    path = join(directory, adapter.fileName);
    replays = join(directory, 'replays');
    const created = await open();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await created.createAccount(account(id));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(rename).mockClear();
    await repository?.close();
    repository = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('writes each archive to its own private file and keeps only a flag in the database', async () => {
    const saved = await reopen();
    await saved.saveMatch(match('m1', ['a', 'b', 'c', 'd'], 20));
    await saved.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, [match('m2', ['a', 'b', 'c', 'd'], 21, archive('bidding')),
      match('m3', ['a', 'b', 'c', 'd'], 22, null)]);
    expect(await storedFiles()).toEqual(['m1.json', 'm2.json']);
    expect((await stat(replays)).mode & 0o777).toBe(0o700);
    expect((await stat(join(replays, 'm1.json'))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(replays, 'm2.json'), 'utf8'))).toEqual(archive('bidding'));
    const database = await adapter.persisted(path);
    expect(database).not.toContain('"steps"');
    expect((await saved.listMatches('a')).map(({ id, hasReplay }) => [id, hasReplay])).toEqual([
      ['m3', undefined], ['m2', true], ['m1', true]]);
    expect(await saved.getMatchReplay('m2')).toEqual(archive('bidding'));
    expect(await saved.getMatchReplay('m3')).toBeUndefined();
    expect(await saved.getMatchReplay('unknown')).toBeUndefined();

    // A replacement without an archive unflags the match and deletes its file after the commit.
    await saved.saveMatch(match('m1', ['a', 'b', 'c', 'd'], 20, null));
    expect(await storedFiles()).toEqual(['m2.json']);
    expect(await (await reopen()).getMatchReplay('m2')).toEqual(archive('bidding'));
  });

  it('rejects invalid archives and IDs that cannot name a file before writing anything', async () => {
    const saved = await reopen();
    const before = await adapter.persisted(path);
    for (const invalid of [
      match('../database', ['a', 'b', 'c', 'd'], 20), match('m.json', ['a', 'b', 'c', 'd'], 20),
      match('m1', ['a', 'b', 'c', 'd'], 5),
      { ...match('m1', ['a', 'b', 'c', 'd'], 20), replay: { ...archive(), steps: [[{ op: 'set', path: ['__proto__'], value: {} }]] } },
      { ...match('m1', ['a', 'b', 'c', 'd'], 20), replay: { version: 2, gameType: 'bridge', log: [] } },
    ] as NewMatchRecord[]) {
      await expect(saved.saveMatch(invalid)).rejects.toMatchObject({ code: 'INVALID_REPLAY' });
    }
    expect(await adapter.persisted(path)).toBe(before);
    expect(await storedFiles()).toEqual([]);
    for (const id of ['../database', 'm1/../../x', '']) expect(await saved.getMatchReplay(id)).toBeUndefined();
    const store = createReplayStore(replays);
    await expect(store.write('../escape', archive())).rejects.toThrow('Invalid match replay ID.');
    await expect(store.read('a/b')).rejects.toThrow('Invalid match replay ID.');
    expect(() => validateDocument({ ...emptyDocument(), accounts: ['a', 'b', 'c', 'd'].map(account),
      matches: [{ ...match('../x', ['a', 'b', 'c', 'd'], 20, null), hasReplay: true }] })).toThrow('schema');
  });

  it('writes files before the commit, and a failed commit leaves no flag or file behind', async () => {
    const saved = await reopen();
    await saved.saveMatch(match('kept', ['a', 'b', 'c', 'd'], 20));
    const archivedAtCommit: boolean[] = [];
    const restore = adapter.failCommits(path, Object.assign(new Error('Disk full'), { code: 'ENOSPC' }),
      () => archivedAtCommit.push(existsSync(join(replays, 'lost.json'))));
    await expect(saved.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, [match('lost', ['a', 'b', 'c', 'd'], 21)]))
      .rejects.toThrow('Disk full');
    expect(archivedAtCommit).toEqual([true]);
    // Overwriting a committed match's archive in a failed commit keeps its file.
    await expect(saved.saveMatch(match('kept', ['a', 'b', 'c', 'd'], 20))).rejects.toThrow('Disk full');
    restore();
    expect(await storedFiles()).toEqual(['kept.json']);
    expect((await saved.listMatches('a')).map((entry) => entry.id)).toEqual(['kept']);
    expect(await saved.getMatchReplay('lost')).toBeUndefined();
    expect(await saved.getMatchReplay('kept')).toEqual(archive());
  });

  it('sweeps orphaned and temporary files at startup and keeps unrelated files', async () => {
    const saved = await reopen();
    await saved.saveMatch(match('kept', ['a', 'b', 'c', 'd'], 20));
    await saved.close();
    await writeFile(join(replays, 'orphan.json'), JSON.stringify(archive()));
    await writeFile(join(replays, 'kept.json.0b6f1f9e.tmp'), '{');
    await writeFile(join(replays, 'notes.txt'), 'operator notes');
    await mkdir(join(replays, 'nested'));
    const reopened = await open();
    expect(await storedFiles()).toEqual(['kept.json', 'nested', 'notes.txt']);
    expect(await reopened.getMatchReplay('kept')).toEqual(archive());
  });

  it('reads missing or corrupt archives as unavailable and reports each once', async () => {
    const saved = await reopen();
    for (const id of ['missing', 'corrupt', 'invalid']) await saved.saveMatch(match(id, ['a', 'b', 'c', 'd'], 20));
    await rm(join(replays, 'missing.json'));
    await writeFile(join(replays, 'corrupt.json'), '{"version":');
    await writeFile(join(replays, 'invalid.json'), JSON.stringify({ ...archive(), gameType: 'holdem' }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (const id of ['missing', 'corrupt', 'invalid']) expect(await saved.getMatchReplay(id)).toBeUndefined();
    }
    expect(errors).toHaveBeenCalledTimes(3);
    expect((await saved.listMatches('a')).every((entry) => entry.hasReplay)).toBe(true);

    // Startup reports flagged matches without files together, without rewriting their results.
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reopened = await reopen();
    expect(warnings).toHaveBeenCalledWith(expect.stringContaining('1 recorded matches have no archive file'));
    expect(await reopened.getMatchReplay('missing')).toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(3);
    expect(await reopened.listMatches('a')).toHaveLength(3);
  });

  it('keeps each account\'s latest 100 matches and shared archives needed by other humans', async () => {
    const saved = await reopen();
    await saved.saveMatch(match('shared', ['a', 'b', 'c', 'd'], 101));
    await saved.saveMatch(match('oldest', ['a', 'e', 'f', 'g'], 102));
    for (let index = 0; index < MAX_MATCHES_PER_ACCOUNT - 1; index += 1) {
      await saved.saveMatch(match(`m${index}`, ['a', 'e', 'f', 'g'], 103 + index));
    }
    expect(await saved.getMatchReplay('shared')).toEqual(archive());
    expect(await saved.getMatchReplay('oldest')).toEqual(archive());
    expect((await saved.listMatches('a')).some((entry) => entry.id === 'shared')).toBe(false);
    expect((await saved.listMatches('b')).map((entry) => entry.id)).toEqual(['shared']);

    // Unrecorded games share the same history slots as recorded games.
    await saved.saveMatch(match('unrecorded', ['a', 'e', 'f', 'g'], 500, null));
    expect(await saved.getMatchReplay('oldest')).toBeUndefined();
    await saved.saveRuntime({ players: [], rooms: [], games: [], chat: [] }, [match('newest', ['a', 'e', 'f', 'g'], 501)]);
    expect(await saved.getMatchReplay('shared')).toEqual(archive());
    const files = await storedFiles();
    expect(files).not.toContain('oldest.json');
    expect(files).not.toContain('m0.json');
    expect(files).toHaveLength(MAX_MATCHES_PER_ACCOUNT);
    const history = await saved.listMatches('a');
    expect(history).toHaveLength(MAX_MATCHES_PER_ACCOUNT);
    expect(history.filter((entry) => entry.hasReplay)).toHaveLength(MAX_MATCHES_PER_ACCOUNT - 1);
    expect((await adapter.readDocument(path)).matches).toHaveLength(MAX_MATCHES_PER_ACCOUNT + 1);
    const reopened = await reopen();
    expect(await reopened.listMatches('a')).toEqual(history);
    expect(await storedFiles()).toEqual(files);
  });

  it('does not let unique bot IDs retain expired history or delete archives before a successful commit', async () => {
    const saved = await reopen();
    const botIds = (): string[] => ['a', ...Array.from({ length: 3 }, () => `bot:${randomUUID()}`)];
    await saved.saveRuntime({ players: [], rooms: [], games: [], chat: [] },
      Array.from({ length: 100 }, (_, index) => match(`bot-${index}`, botIds(), 100 + index)));
    const restore = adapter.failCommits(path, new Error('Disk full'));
    const next = match('next-bot', botIds(), 200);
    await expect(saved.saveMatch(next)).rejects.toThrow('Disk full');
    expect(await saved.getMatchReplay('bot-0')).toEqual(archive());
    expect(await saved.getMatchReplay('next-bot')).toBeUndefined();
    expect(await storedFiles()).toHaveLength(100);
    restore();
    await saved.saveMatch(next);
    expect(await saved.getMatchReplay('bot-0')).toBeUndefined();
    expect(await storedFiles()).toHaveLength(100);
    expect((await adapter.readDocument(path)).matches).toHaveLength(100);
    expect((await saved.listMatches('a'))[0].id).toBe('next-bot');
  });

  it('uses stable completion order for ties and prunes old inserts and replacement participants', async () => {
    const saved = await reopen();
    await saved.saveRuntime({ players: [], rooms: [], games: [], chat: [] },
      Array.from({ length: 101 }, (_, index) => match(`tie-${index}`, ['a', 'b', 'c', 'd'], 200)));
    expect((await saved.listMatches('a')).map((entry) => entry.id))
      .toEqual(Array.from({ length: 100 }, (_, index) => `tie-${index}`));
    expect(await saved.getMatchReplay('tie-100')).toBeUndefined();
    await saved.saveMatch(match('old-insert', ['a', 'b', 'c', 'd'], 100));
    expect(await saved.getMatchReplay('old-insert')).toBeUndefined();
    await saved.saveMatch(match('shared', ['a', 'e', 'f', 'g'], 100));
    expect(await saved.getMatchReplay('shared')).toEqual(archive());
    await saved.saveMatch(match('shared', ['a', 'b', 'c', 'd'], 100));
    expect(await saved.getMatchReplay('shared')).toBeUndefined();
    expect(await saved.listMatches('e')).toEqual([]);
    expect(await storedFiles()).toHaveLength(100);
  });

  it('validates flagged matches without reading or applying archives; reads apply every step', async () => {
    const saved = await reopen();
    await saved.saveMatch(match('m1', ['a', 'b', 'c', 'd'], 20));
    const document = (await adapter.readDocument(path)) as { runtime: RuntimeSnapshot | null };
    vi.mocked(applyReplayPatch).mockClear();
    // Flagged matches never cost archive validation on a write.
    const many = { ...document, matches: Array.from({ length: 1_000 }, (_, index) =>
      ({ ...match(`m${index}`, ['a', 'b', 'c', 'd'], 20 + index, null), hasReplay: true })) };
    validateDocument(many, { applyReplaySteps: false });
    validateDocument(many);
    expect(applyReplayPatch).not.toHaveBeenCalled();
    expect(await saved.getMatchReplay('m1')).toEqual(archive());
    expect(applyReplayPatch).toHaveBeenCalledTimes(1);
  });
});
