import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import type { GameType, MatchReplay } from '@shared/types';
import type { MatchRecord, Repository } from '../../src/database/repository';
import { createStatsStage, replayFrame } from '../../src/database/game-stats';
import type { AccountStatsRecord, GameStatsRecord, StatsSource } from '../../src/database/game-stats';
import { STATS_BACKFILL_BATCH } from '../../src/database/stats-backfill';
import { emptyDocument } from '../../src/database/schema';
import type { DatabaseDocument } from '../../src/database/schema';
import { createStatements, insertDocument } from '../../src/database/sqlite-store';
import { inTransaction, openSqliteDatabase } from '../../src/database/sqlite-schema';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import type { RepositoryAdapter } from '../helpers/repository-adapters';
import { account, populate, resetRuntime } from '../helpers/storage-fixture';
import { recordMatch } from '../client/replay-fixtures';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const BOTS = [1, 2, 3].map((index) => `bot:00000000-0000-4000-8000-00000000000${index}`);
const SEAT_IDS = ['account-N', 'account-E', 'account-S', 'account-W'];
const FILLERS = ['filler-a', 'filler-b', 'filler-c', 'filler-d'];

interface Fixture {
  /** A schema v8 document: no statistics yet */
  readonly document: Record<string, unknown>;
  readonly replays: ReadonlyMap<string, MatchReplay>;
  readonly matches: readonly MatchRecord[];
  /** The oldest completion time */
  readonly base: number;
}

/** Recorded matches of every game, then enough plain Bridge results for several backfill batches. */
function fixture(): Fixture {
  const accounts = [...SEAT_IDS, ...FILLERS].map((id, index) => ({ ...account(`player_${index}`), id,
    ...(index === 1 ? { achievements: { games: 500, wins: 0, gameTypes: ['bridge'], dailyTasks: 0 } } : {}) }));
  const replays = new Map<string, MatchReplay>();
  const matches: MatchRecord[] = [];
  const recorded = GAME_TYPES.map((gameType, index) => ({ gameType, ...recordMatch(gameType, `B${index}`) }));
  const base = Math.max(...recorded.map(({ replay }) => replay.startedAt)) + 1;
  for (const [index, { gameType, replay, match }] of recorded.entries()) {
    const id = `recorded-${gameType}`;
    replays.set(id, replay);
    matches.push({ ...match, id, finishedAt: base + index, hasReplay: true });
  }
  const bridge = (id: string, accountIds: readonly string[], finishedAt: number, index: number): MatchRecord => ({
    id, roomCode: 'ABC123', accountIds, finishedAt,
    result: { gameType: 'bridge', contract: { level: index % 7 === 0 ? 6 : 2, suit: 'nt', declarer: 'N' },
      declarerTeamTricks: index % 2 ? 8 : 12, defenderTeamTricks: index % 2 ? 5 : 1,
      requiredTricks: index % 7 === 0 ? 12 : 8, declarerTeamWins: index % 2 ? index % 7 !== 0 : true } });
  // The first ones complete with the first recorded match, so their order falls back to the ID.
  for (let index = 0; index < 60; index++) {
    matches.push(bridge(`bridge-${String(index).padStart(4, '0')}`, index % 3 === 0 ? [SEAT_IDS[0], BOTS[0], SEAT_IDS[2], SEAT_IDS[3]]
      : SEAT_IDS, index < 5 ? base : base + 1_000 + index, index));
  }
  // Enough further matches for several batches, spread so that no account exceeds the history limit.
  for (let index = 0; index < STATS_BACKFILL_BATCH; index++) {
    matches.push(bridge(`filler-${String(index).padStart(4, '0')}`, [FILLERS[index % FILLERS.length], ...BOTS],
      base + 2_000 + index, index));
  }
  // A shuffled insertion order: the backfill must count by completion time.
  const shuffled = [...matches].sort((first, second) => first.id.localeCompare(second.id));
  const document = { ...emptyDocument(), schemaVersion: 8, accounts, matches: shuffled } as Record<string, unknown>;
  delete document.gameStats;
  delete document.accountStats;
  return { document, replays, matches, base };
}

/** The counters the backfill should reach: every match counted once, oldest first. */
function expected(data: Fixture): { games: GameStatsRecord[]; accounts: AccountStatsRecord[] } {
  const games = new Map<string, GameStatsRecord>();
  const accounts = new Map<string, AccountStatsRecord>();
  const source: StatsSource = {
    game: (accountId, gameType, scope) => games.get(JSON.stringify([accountId, gameType, scope])) ?? null,
    account: (accountId, scope) => accounts.get(JSON.stringify([accountId, scope])) ?? null,
  };
  const ordered = [...data.matches].sort((first, second) => first.finishedAt - second.finishedAt
    || (first.id < second.id ? -1 : 1));
  for (const match of ordered) {
    const stage = createStatsStage(source, (id) => !id.startsWith('bot:'));
    // Account E has more completed games than stored matches, so its older results were pruned.
    stage.count(match, replayFrame(data.replays.get(match.id)), (id) => id === 'account-E' ? data.base : null);
    for (const [key, record] of stage.games) games.set(key, record);
    for (const [key, record] of stage.accounts) accounts.set(key, record);
  }
  return { games: [...games.values()], accounts: [...accounts.values()] };
}

async function writeReplays(directory: string, replays: ReadonlyMap<string, MatchReplay>): Promise<void> {
  await mkdir(join(directory, 'replays'), { recursive: true, mode: 0o700 });
  for (const [id, replay] of replays) await writeFile(join(directory, 'replays', `${id}.json`), JSON.stringify(replay), { mode: 0o600 });
}

/** Seeds a schema v8 database: the JSON file as is; SQLite created at v9 without statistics, then marked v8. */
async function seedVersion8(adapter: RepositoryAdapter, path: string, document: Record<string, unknown>): Promise<void> {
  if (adapter.name === 'json') {
    await writeFile(path, JSON.stringify(document));
    return;
  }
  const { database } = await openSqliteDatabase(path);
  try {
    const sql = createStatements(database);
    inTransaction(database, () => insertDocument(sql, { ...document, schemaVersion: 9, gameStats: [], accountStats: [] } as unknown as DatabaseDocument));
    for (const table of ['game_stats', 'account_stats', 'stats_backfill']) database.exec(`DROP TABLE ${table}`);
    database.exec('PRAGMA user_version = 8');
  } finally {
    database.close();
  }
}

function sortedStats(document: DatabaseDocument): unknown {
  const key = (record: { accountId: string; scope: string; gameType?: GameType }): string =>
    `${record.accountId} ${record.gameType ?? ''} ${record.scope}`;
  return {
    games: [...document.gameStats].sort((first, second) => key(first).localeCompare(key(second))),
    accounts: [...document.accountStats].sort((first, second) => key(first).localeCompare(key(second))),
  };
}

describe.each(REPOSITORY_ADAPTERS)('statistics backfill ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository | undefined;
  let data: Fixture;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'game-stats-'));
    path = join(directory, adapter.fileName);
    data = fixture();
    await writeReplays(directory, data.replays);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(rename).mockClear();
    resetRuntime();
    await repository?.close();
    repository = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  it('counts every stored match of a v8 database once, in completion order, with replay logs', async () => {
    await seedVersion8(adapter, path, data.document);
    repository = await adapter.open(path);
    const stored = await adapter.readDocument(path);
    expect(stored.statsBackfill).toBeUndefined();
    const reference = expected(data);
    expect(sortedStats(stored)).toEqual(sortedStats({ ...stored, gameStats: reference.games, accountStats: reference.accounts }));

    const north = await repository.getPlayerStats('account-N');
    const bridge = (scope: 'human' | 'all') => north.scopes[scope].games.find((entry) => entry.gameType === 'bridge')!;
    const synthetic = data.matches.filter((match) => match.id.startsWith('bridge-'));
    expect(bridge('all').matches).toBe(synthetic.length + 1);
    expect(bridge('human').matches).toBe(synthetic.filter((match) => !match.accountIds.includes(BOTS[0])).length + 1);
    expect(stored.matches).toHaveLength(data.matches.length);
    expect(bridge('all')).toMatchObject({ logged: 1, since: null });
    // Bridge results stored at the same time as the recorded Bridge match sort before it, so log records start there.
    for (const game of north.scopes.all.games) expect(game.logSince).toBe(game.gameType === 'bridge' ? data.base : null);
    expect(north.scopes.all.games.map((game) => game.gameType)).toEqual(GAME_TYPES);
    expect((await repository.getPlayerStats('account-E')).scopes.human.account?.since).toBe(data.base);
    expect(north.scopes.all.account?.recent).toHaveLength(10);

    // Reopening does not count again.
    const before = await adapter.persisted(path);
    await repository.close();
    repository = await adapter.open(path);
    expect(await adapter.persisted(path)).toBe(before);
  });

  it('resumes an interrupted backfill after its last committed batch without counting twice', async () => {
    await seedVersion8(adapter, path, data.document);
    const failure = new Error('power lost');
    let commits = 0;
    // The migration and the first batch commit; the second batch fails.
    const allow = adapter.name === 'json' ? 2 : 1;
    const original = vi.mocked(rename).getMockImplementation()!;
    if (adapter.name === 'json') {
      vi.mocked(rename).mockImplementation(async (from, to) => {
        if (to === path && ++commits > allow) throw failure;
        return original(from, to);
      });
    } else {
      const exec = DatabaseSync.prototype.exec;
      vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
        if (sql === 'COMMIT' && ++commits > allow + 1) throw failure;
        return exec.call(this, sql);
      });
    }
    await expect(adapter.open(path)).rejects.toThrow('power lost');
    vi.mocked(rename).mockImplementation(original);
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const partial = await adapter.readDocument(path);
    expect(partial.statsBackfill?.after).toEqual(expect.objectContaining({ matchId: expect.any(String) }));
    expect(partial.gameStats.length).toBeGreaterThan(0);

    repository = await adapter.open(path);
    const stored = await adapter.readDocument(path);
    expect(stored.statsBackfill).toBeUndefined();
    const reference = expected(data);
    expect(sortedStats(stored)).toEqual(sortedStats({ ...stored, gameStats: reference.games, accountStats: reference.accounts }));
  });

  it('starts new databases without a backfill and counts live recorded games with their log', async () => {
    repository = await adapter.open(path);
    expect((await adapter.readDocument(path)).statsBackfill).toBeUndefined();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const [alice] = await populate(repository);
      const stats = await repository.getPlayerStats(alice.id);
      // A game against bots counts only when bots are included.
      expect(stats.scopes.human).toEqual({ account: null, games: [] });
      expect(stats.scopes.all.games).toEqual([expect.objectContaining({ gameType: 'redpoints', matches: 1, logged: 1 })]);
    } finally {
      vi.useRealTimers();
    }
  });
});
