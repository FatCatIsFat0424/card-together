import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyGameState, DailyRewardId, DailyTaskId, PlayerInfo, Seat } from '@shared/types';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import {
  dailyDate, dailyGameProgress, dailyState, dailyStatus, favoriteGames, recentGameCounts, replacementTask, taskProgress,
  validDailyRewards,
} from '../../src/database/daily-rewards';
import type { RecentGames } from '../../src/database/daily-rewards';
import { DAILY_TASKS, dailyTaskPool, favoriteTaskFor } from '@shared/constants/daily-rewards';
import { GAME_TYPES } from '@shared/constants';
import type { DailyRewardsRecord } from '../../src/database/daily-rewards';
import type { MatchRecord, Repository } from '../../src/database/repository';
import { seedAuthenticatedAccount } from '../auth/account-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const DAY_MS = 86_400_000;
const noHistory: RecentGames = () => ({});

describe.each(REPOSITORY_ADAPTERS)('daily reward transactions ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let now: number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'daily-rewards-'));
    path = join(directory, adapter.fileName);
    now = Date.parse('2026-10-15T15:59:59Z');
    repository = await adapter.open(path, { now: () => now });
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function seed(dailyRewards?: DailyRewardsRecord): Promise<string> {
    return (await seedAuthenticatedAccount(repository, 'alice', { dailyRewards }, { now })).account.id;
  }
  function match(id: string, accountId: string, gameType: 'bridge' | 'redpoints', finishedAt: number): MatchRecord {
    const bots = ['1', '2', '3'].map((digit) => `bot:${digit.repeat(8)}-0000-4000-8000-000000000000`);
    return { id, roomCode: 'ABC123', finishedAt, accountIds: [accountId, ...bots],
      result: gameType === 'bridge'
        ? { gameType, contract: { level: 1, suit: 'nt', declarer: 'N' }, declarerTeamTricks: 7, defenderTeamTricks: 6,
          requiredTricks: 7, declarerTeamWins: true }
        : { gameType, points: { N: 80, E: 60, S: 44, W: 24 }, winners: ['N'] } };
  }

  it('reads old accounts without rewriting them and uses the Taiwan day boundary', async () => {
    const id = await seed();
    const before = await adapter.persisted(path);
    expect(await repository.getDailyRewards(id)).toMatchObject({ day: '2026-10-15',
      resetsAt: Date.parse('2026-10-15T16:00:00Z'), gameTypes: [], wins: 0, claimedTasks: [], checkInDays: [] });
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.getDailyRewards('missing')).toBeNull();
    now += 1000;
    expect(await repository.getDailyRewards(id)).toMatchObject({ day: '2026-10-16' });
  });

  it('credits check-in once under concurrent requests and after reopening', async () => {
    const id = await seed();
    await Promise.all(Array.from({ length: 8 }, () => repository.claimDailyReward(id, 'check-in', '2026-10-15')));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 10, coinRevision: 1 });
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect(await repository.claimDailyReward(id, 'check-in', '2026-10-15')).toMatchObject({
      account: { coins: 10, coinRevision: 1 }, dailyRewards: { checkInDays: ['2026-10-15'] },
    });
    now += 1000;
    await repository.claimDailyReward(id, 'check-in', '2026-10-16');
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 20, coinRevision: 2 });
  });

  it('rejects past/future dates, incomplete tasks, and forged reward IDs', async () => {
    const id = await seed();
    for (const day of ['2026-10-14', '2026-10-16']) {
      await expect(repository.claimDailyReward(id, 'check-in', day)).rejects.toMatchObject({ code: 'DAILY_DATE_CHANGED' });
    }
    for (const { id: reward } of (await repository.getDailyRewards(id))!.tasks) {
      await expect(repository.claimDailyReward(id, reward, '2026-10-15')).rejects.toMatchObject({ code: 'DAILY_TASK_INCOMPLETE' });
    }
    await expect(repository.claimDailyReward(id, 'fake' as DailyRewardId, '2026-10-15'))
      .rejects.toMatchObject({ code: 'INVALID_DAILY_REWARD' });
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 0 });
  });

  it('keeps a pre-redesign assignment with retired IDs until the reset, then draws from the slot pools', async () => {
    const id = await seed({ day: '2026-10-15', gameTypes: ['bridge', 'bigtwo', 'holdem'], wins: 2,
      taskIds: ['play-variety', 'win-two', 'play-casino'], claimedTasks: [], checkInDays: ['2026-09-30'],
      gameCounts: { bridge: 1, bigtwo: 1, holdem: 1 } });
    expect((await repository.getDailyRewards(id))!.tasks).toEqual([
      { id: 'play-variety', progress: 3, replaceable: false }, { id: 'win-two', progress: 2, replaceable: false },
      { id: 'play-casino', progress: 1, replaceable: false },
    ]);
    await Promise.all(['play-variety', 'win-two', 'check-in', 'win-two', 'play-casino'].map((reward) =>
      repository.claimDailyReward(id, reward as DailyRewardId, '2026-10-15')));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 65, coinRevision: 4 });
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect(await repository.getDailyRewards(id)).toMatchObject({ checkInDays: ['2026-10-15'], claimedTasks: expect.arrayContaining(
      ['play-variety', 'win-two', 'play-casino']) });
    now += 1000;
    const next = (await repository.getDailyRewards(id))!;
    expect(next).toMatchObject({ gameTypes: [], wins: 0, claimedTasks: [], swapsRemaining: 1 });
    expect(next.tasks.map((task) => task.id).filter((task) => task === 'play-variety' || task === 'play-casino')).toEqual([]);
    await repository.claimDailyReward(id, 'check-in', '2026-10-16');
    await Promise.all([
      repository.purchaseAvatarBorder(id, 'copper', now),
      repository.claimDailyReward(id, 'check-in', '2026-10-16'),
    ]);
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 25, coinRevision: 6, ownedAvatarBorders: ['copper'] });
    now = Date.parse('2026-10-31T16:00:00Z');
    expect(await repository.getDailyRewards(id)).toMatchObject({ day: '2026-11-01', checkInDays: [] });
  });

  it('rolls back receipts and balances if persistence fails, allowing a safe retry', async () => {
    const id = await seed();
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('disk full'));
    await expect(repository.claimDailyReward(id, 'check-in', '2026-10-15')).rejects.toThrow('disk full');
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.getDailyRewards(id)).toMatchObject({ checkInDays: [] });
    expect(await repository.claimDailyReward(id, 'check-in', '2026-10-15')).toMatchObject({ account: { coins: 10 } });
  });

  it('gives a new player a play, a challenge, and a second play task, stable across restarts', async () => {
    const id = await seed();
    const first = (await repository.getDailyRewards(id))!;
    const ids = first.tasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(3);
    expect(dailyTaskPool('play')).toContain(ids[0]);
    expect(dailyTaskPool('challenge')).toContain(ids[1]);
    expect(dailyTaskPool('play')).toContain(ids[2]);
    expect(first.tasks.every((task) => !task.favorite && task.replaceable)).toBe(true);
    expect((await repository.getDailyRewards(id))!.tasks).toEqual(first.tasks);
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect((await repository.getDailyRewards(id))!.tasks).toEqual(first.tasks);
    const unseen = DAILY_TASKS.find((task) => !ids.includes(task.id))!;
    await expect(repository.claimDailyReward(id, unseen.id, first.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNASSIGNED' });
  });

  it('draws the third task from the 14 days of history before today and swaps it for another favorite', async () => {
    const id = await seed();
    const today = Date.parse('2026-10-14T16:00:00Z');
    for (const [index, finishedAt] of [today - DAY_MS, today - 2 * DAY_MS, today - 14 * DAY_MS].entries()) {
      await repository.saveMatch(match(`bridge-${index}`, id, 'bridge', finishedAt));
    }
    await repository.saveMatch(match('redpoints', id, 'redpoints', today - 3 * DAY_MS));
    // Outside the window: older than 14 days, or played today.
    for (let index = 0; index < 5; index += 1) {
      await repository.saveMatch(match(`old-${index}`, id, 'redpoints', today - 14 * DAY_MS - 1));
      await repository.saveMatch(match(`today-${index}`, id, 'redpoints', today + index));
    }
    const status = (await repository.getDailyRewards(id))!;
    const favorite = status.tasks[2];
    expect(favorite).toMatchObject({ favorite: true, progress: 0, replaceable: true });
    expect(['play-bridge', 'play-redpoints']).toContain(favorite.id);
    const swapped = (await repository.replaceDailyTask(id, favorite.id, status.day))!.dailyRewards;
    expect(swapped.tasks[2]).toEqual({ id: favorite.id === 'play-bridge' ? 'play-redpoints' : 'play-bridge',
      progress: 0, replaceable: false, favorite: true });
    expect(swapped.tasks.slice(0, 2).map((task) => task.id)).toEqual(status.tasks.slice(0, 2).map((task) => task.id));
  });

  it('serializes competing swaps, keeps the replacement on retry/restart, and blocks removed tasks', async () => {
    const id = await seed();
    const first = (await repository.getDailyRewards(id))!;
    const from = first.tasks[0].id;
    const results = await Promise.allSettled([
      repository.replaceDailyTask(id, from, first.day),
      repository.replaceDailyTask(id, first.tasks[1].id, first.day),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'DAILY_REPLACE_USED' } });
    const changed = (await repository.getDailyRewards(id))!;
    expect(changed.swapsRemaining).toBe(0);
    expect(changed.tasks.map((task) => task.id)).not.toContain(from);
    expect(dailyTaskPool('play')).toContain(changed.tasks[0].id);
    expect(new Set(changed.tasks.map((task) => task.id)).size).toBe(3);
    expect(changed.tasks.slice(1).map((task) => task.id)).toEqual(first.tasks.slice(1).map((task) => task.id));
    expect(changed.tasks.every((task) => !task.replaceable)).toBe(true);
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect((await repository.replaceDailyTask(id, from, first.day))!.dailyRewards.tasks).toEqual(changed.tasks);
    await expect(repository.claimDailyReward(id, from, first.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNASSIGNED' });
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 0 });
    now += 1000;
    expect(await repository.getDailyRewards(id)).toMatchObject({ swapsRemaining: 1, claimedTasks: [] });
    await expect(repository.replaceDailyTask(id, from, first.day)).rejects.toMatchObject({ code: 'DAILY_DATE_CHANGED' });
  });

  it('swaps only unstarted tasks, within the same slot pool and different from every current task', async () => {
    const id = await seed({ day: '2026-10-15', gameTypes: ['bigtwo'], wins: 0, claimedTasks: [], checkInDays: [],
      gameCounts: { bigtwo: 1 }, matches: 1, humanMatches: 0, taskIds: ['play-any-3', 'win-two', 'play-any-2'] });
    const status = (await repository.getDailyRewards(id))!;
    expect(status.tasks.map((task) => task.replaceable)).toEqual([false, true, false]);
    await expect(repository.replaceDailyTask(id, 'play-any-3', status.day)).rejects.toMatchObject({ code: 'DAILY_TASK_STARTED' });
    await expect(repository.replaceDailyTask(id, 'play-gomoku', status.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNAVAILABLE' });
    const swapped = (await repository.replaceDailyTask(id, 'win-two', status.day))!.dailyRewards;
    expect(swapped.tasks.map((task) => task.id)).toEqual(['play-any-3', swapped.tasks[1].id, 'play-any-2']);
    expect(dailyTaskPool('challenge').filter((task) => task !== 'win-two')).toContain(swapped.tasks[1].id);
  });

  it('preserves claimed legacy tasks and refuses to replace them', async () => {
    const id = await seed({ day: '2026-10-15', gameTypes: ['bridge', 'bigtwo', 'holdem'], wins: 2,
      claimedTasks: ['play-variety', 'win-two'], checkInDays: [] });
    const status = (await repository.getDailyRewards(id))!;
    expect(status.tasks.map((task) => task.id)).toEqual(expect.arrayContaining(['play-variety', 'win-two']));
    await expect(repository.replaceDailyTask(id, 'play-variety', status.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNAVAILABLE' });
    expect((await repository.claimDailyReward(id, 'play-variety', status.day))!.account.coins).toBe(0);
  });

  it('rolls back a failed replacement without spending the allowance or changing assignments', async () => {
    const id = await seed();
    const first = (await repository.getDailyRewards(id))!;
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('disk full'));
    await expect(repository.replaceDailyTask(id, first.tasks[0].id, first.day)).rejects.toThrow('disk full');
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.getDailyRewards(id)).toMatchObject({ tasks: first.tasks, swapsRemaining: 1 });
    expect((await repository.replaceDailyTask(id, first.tasks[0].id, first.day))!.dailyRewards.swapsRemaining).toBe(0);
  });

  it.each(DAILY_TASKS)('credits the completed assigned $id once at its catalog price', async (task) => {
    const id = await seed({ day: '2026-10-15', gameTypes: [...GAME_TYPES], wins: 2, claimedTasks: [], checkInDays: [],
      gameCounts: Object.fromEntries(GAME_TYPES.map((type) => [type, 2])), matches: 4, humanMatches: 1,
      taskIds: [task.id, ...DAILY_TASKS.filter((entry) => entry.id !== task.id).slice(0, 2).map((entry) => entry.id)],
    });
    const status = (await repository.getDailyRewards(id))!;
    expect(status.tasks[0]).toEqual({ id: task.id, progress: task.target, replaceable: false });
    await Promise.all(Array.from({ length: 4 }, () => repository.claimDailyReward(id, task.id, status.day)));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: task.coins, coinRevision: 1 });
  });
});

describe('daily task assignment', () => {
  const now = Date.parse('2026-10-15T10:00:00Z');
  const accounts = Array.from({ length: 300 }, (_, index) => `player-${index}`);

  it('has one favorite task per game and keeps the daily payout near the previous 40 coins', () => {
    expect(GAME_TYPES.map(favoriteTaskFor)).toHaveLength(new Set(GAME_TYPES.map(favoriteTaskFor)).size);
    const average = (ids: readonly DailyTaskId[]): number =>
      ids.reduce((sum, id) => sum + DAILY_TASKS.find((task) => task.id === id)!.coins, 0) / ids.length;
    const daily = average(dailyTaskPool('play')) + average(dailyTaskPool('challenge')) + average(dailyTaskPool('favorite'));
    expect(daily).toBeGreaterThanOrEqual(38);
    expect(daily).toBeLessThanOrEqual(45);
  });

  it('weights favorites by recent match count, keeps only the top three, and varies across accounts', () => {
    const recent: RecentGames = () => ({ bigtwo: 12, gomoku: 4, bridge: 2, xiangqi: 1 });
    const third = accounts.map((account) => dailyState(undefined, now, account, recent).taskIds[2]);
    const tally = (id: DailyTaskId): number => third.filter((task) => task === id).length;
    expect(new Set(third)).toEqual(new Set(['play-bigtwo', 'play-gomoku', 'play-bridge']));
    expect(tally('play-bigtwo')).toBeGreaterThan(tally('play-gomoku'));
    expect(tally('play-gomoku')).toBeGreaterThan(tally('play-bridge'));
    expect(new Set(accounts.map((account) => dailyState(undefined, now, account, noHistory).taskIds.join(','))).size).toBeGreaterThan(1);
    expect(favoriteGames({ reversi: 2, bridge: 2, banqi: 5 }).map((entry) => entry.gameType)).toEqual(['banqi', 'bridge', 'reversi']);
  });

  it('is deterministic per account and day, and reads history only when drawing', () => {
    const recent = vi.fn(() => ({ bigtwo: 3 }));
    const first = dailyState(undefined, now, 'S', recent);
    expect(first).toMatchObject({ favoriteTask: 'play-bigtwo' });
    expect(first.taskIds[2]).toBe('play-bigtwo');
    expect(dailyState(undefined, now + 3_600_000, 'S', recent).taskIds).toEqual(first.taskIds);
    expect(recent).toHaveBeenCalledTimes(2);
    dailyStatus(first, now, 'S', recent);
    expect(recent).toHaveBeenCalledTimes(2);
    const days = new Set(Array.from({ length: 20 }, (_, day) => dailyState(undefined, now + day * DAY_MS, 'S', noHistory).taskIds.join(',')));
    expect(days.size).toBeGreaterThan(1);
  });

  it('counts only matches in the 14 Taiwan days before today', () => {
    const today = Date.parse('2026-10-14T16:00:00Z');
    const at = (finishedAt: number, gameType: 'bridge' | 'bigtwo' = 'bridge') => ({ finishedAt, result: { gameType } });
    expect(recentGameCounts([at(today - 1), at(today - 14 * DAY_MS), at(today - 14 * DAY_MS - 1), at(today), at(today - 5, 'bigtwo')], now))
      .toEqual({ bridge: 2, bigtwo: 1 });
  });

  it('replaces the favorite slot with another favorite, then falls back to an unassigned play task', () => {
    const two: RecentGames = () => ({ bigtwo: 3, gomoku: 1 });
    const state = dailyState(undefined, now, 'S', two);
    const current = state.taskIds[2];
    expect(replacementTask(state, 2, 'S', two)).toEqual({ id: current === 'play-bigtwo' ? 'play-gomoku' : 'play-bigtwo',
      weight: expect.any(Number), favorite: true });
    const one: RecentGames = () => ({ bigtwo: 3 });
    const single = dailyState(undefined, now, 'S', one);
    const fallback = replacementTask(single, 2, 'S', one)!;
    expect(fallback.favorite).toBe(false);
    expect(dailyTaskPool('play')).toContain(fallback.id);
    expect(single.taskIds).not.toContain(fallback.id);
    const challenge = replacementTask(single, 1, 'S', one)!;
    expect(dailyTaskPool('challenge')).toContain(challenge.id);
    expect(challenge.id).not.toBe(single.taskIds[1]);
  });
});

describe('daily completed-game progress', () => {
  const now = Date.parse('2026-10-15T10:00:00Z');
  const players = Object.fromEntries(['N', 'E', 'S', 'W'].map((seat) => [seat, {
    id: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
  }])) as Record<Seat, PlayerInfo>;
  const bridge: Pick<AnyGameState, 'gameType' | 'players' | 'result'> = {
    gameType: 'bridge', players,
    result: { contract: { level: 4, suit: 'spades', declarer: 'N' }, declarerTeamTricks: 10,
      defenderTeamTricks: 3, requiredTricks: 10, declarerTeamWins: true },
  };
  const progress = (record: DailyRewardsRecord | undefined, game: typeof bridge, account: string, at = now): DailyRewardsRecord =>
    dailyGameProgress(record, game, account, at, noHistory);
  it('counts completed types once and partnership wins, caps progress, and leaves input immutable', () => {
    const initial = dailyState(undefined, now, 'S', noHistory);
    const first = progress(initial, bridge, 'S');
    const second = progress(first, bridge, 'S');
    expect(progress(second, bridge, 'S')).toMatchObject({ gameTypes: ['bridge'], wins: 2, matches: 3 });
    expect(progress(initial, bridge, 'E').wins).toBe(0);
    expect(initial).toMatchObject({ gameTypes: [], wins: 0, matches: 0 });
    expect(progress(first, bridge, 'S', now + 86_400_000)).toMatchObject({ wins: 1, claimedTasks: [], matches: 1 });
    let capped = first;
    for (let index = 0; index < 6; index += 1) capped = progress(capped, bridge, 'S');
    expect(capped).toMatchObject({ matches: 4, humanMatches: 1 });
  });
  it('counts games with another human seated, but not bot-only tables', () => {
    const bots = { ...bridge, players: Object.fromEntries(Object.entries(players).map(([seat, player]) =>
      [seat, seat === 'N' ? player : { ...player, isBot: true }])) as Record<Seat, PlayerInfo> };
    expect(progress(undefined, bots, 'N')).toMatchObject({ matches: 1, humanMatches: 0 });
    expect(progress(undefined, bridge, 'N')).toMatchObject({ matches: 1, humanMatches: 1 });
  });
  it('excludes unfinished games, spectators, bots and losses from wins, but counts tied leaders', () => {
    expect(progress(undefined, { ...bridge, result: null }, 'N').gameTypes).toEqual([]);
    expect(progress(undefined, bridge, 'spectator').gameTypes).toEqual([]);
    expect(progress(undefined, { ...bridge, players: { ...players, N: { ...players.N, isBot: true } } }, 'N').gameTypes).toEqual([]);
    const tied: typeof bridge = { gameType: 'redpoints', players,
      result: { gameType: 'redpoints', points: { N: 80, E: 80, S: 24, W: 24 }, winners: ['N', 'E'] } };
    expect(progress(undefined, tied, 'N')).toMatchObject({ gameTypes: ['redpoints'], wins: 1 });
    expect(progress(undefined, tied, 'S')).toMatchObject({ gameTypes: ['redpoints'], wins: 0 });
    const lastSurvivor: typeof bridge = { gameType: 'ninetynine', players,
      result: { gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 } };
    expect(progress(undefined, lastSurvivor, 'W').wins).toBe(1);
    expect(progress(undefined, lastSurvivor, 'N').wins).toBe(0);
    expect(progress(undefined, { ...tied, result: { gameType: 'redpoints', points: { N: 80, E: 60, S: 44, W: 24 }, winners: ['N'] } }, 'N').wins).toBe(1);
  });
  it('validates dates, progress, and unique durable receipts', () => {
    const state = dailyState(undefined, now, 'S', () => ({ bigtwo: 1 }));
    expect(validDailyRewards(state)).toBe(true);
    for (const patch of [{ day: '2026-02-30' }, { wins: -1 }, { wins: 3 }, { gameTypes: ['bridge', 'bridge'] },
      { gameTypes: ['fake'] }, { claimedTasks: ['win-two'] }, { checkInDays: ['2026-10-15', '2026-10-15'] },
      { taskIds: ['win-two', 'win-two', 'play-variety'] }, { taskIds: ['win-two'] }, { taskIds: ['fake', 'win-two', 'play-variety'] },
      { gameCounts: { bridge: -1 } }, { gameCounts: { fake: 1 } }, { replacement: { from: 'fake', to: 'win-two' } },
      { matches: 5 }, { matches: 1.5 }, { humanMatches: 2 }, { favoriteTask: 'win-two' }, { favoriteTask: 'play-gomoku' },
      { claimedTasks: ['play-any-2'], taskIds: ['play-any-2', 'win-two', 'play-bigtwo'], matches: 1 }]) {
      expect(validDailyRewards({ ...state, ...patch })).toBe(false);
    }
    expect(dailyDate(Date.parse('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
  it('reads pre-redesign records: retired IDs validate and any-game progress comes from per-game counts', () => {
    const legacy: DailyRewardsRecord = { day: '2026-10-15', gameTypes: ['bigtwo', 'bridge'], wins: 1, checkInDays: [],
      gameCounts: { bigtwo: 2, bridge: 1 }, taskIds: ['play-casino', 'play-variety', 'play-bigtwo'], claimedTasks: ['play-bigtwo'],
      replacement: { from: 'play-gomoku', to: 'play-bigtwo' } };
    expect(validDailyRewards(legacy)).toBe(true);
    expect(taskProgress(legacy, 'play-any-3')).toBe(3);
    expect(dailyState(legacy, now, 'S', noHistory)).toMatchObject({ matches: 3, humanMatches: 0, taskIds: legacy.taskIds });
    expect(dailyStatus(legacy, now, 'S', noHistory).tasks.every((task) => !task.favorite && !task.replaceable)).toBe(true);
  });
  it('increments per-game counts and uses the same daily activity for newly drawn tasks', () => {
    const first = progress(undefined, bridge, 'N');
    expect(first.gameCounts).toEqual({ bridge: 1 });
    expect(taskProgress(first, 'play-bridge')).toBe(1);
    expect(taskProgress(first, 'play-bigtwo')).toBe(0);
    expect(taskProgress(first, 'play-any-2')).toBe(1);
    const played = { ...first, gameTypes: ['bridge', 'bigtwo'] as const, gameCounts: { ...first.gameCounts, bigtwo: 1, blackjack: 1 } };
    expect(taskProgress(played, 'play-bigtwo')).toBe(1);
    expect(taskProgress(played, 'play-two-kinds')).toBe(2);
    expect(taskProgress(played, 'play-casino')).toBe(1);
    expect(taskProgress({ ...played, gameCounts: { holdem: 1 } }, 'play-casino')).toBe(1);
    expect(taskProgress({ ...played, gameCounts: { stud: 1 } }, 'play-casino')).toBe(1);
  });
});
