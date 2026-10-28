import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnyGameState, DailyRewardId, PlayerInfo, Seat } from '@shared/types';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { dailyDate, dailyGameProgress, dailyState, taskProgress, validDailyRewards } from '../../src/database/daily-rewards';
import { DAILY_TASKS } from '@shared/constants/daily-rewards';
import { GAME_TYPES } from '@shared/constants';
import type { DailyRewardsRecord } from '../../src/database/daily-rewards';
import type { Repository } from '../../src/database/repository';
import { seedAuthenticatedAccount } from '../auth/account-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

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

  it('credits all three rewards once, preserves purchase debits, and resets progress each day', async () => {
    const id = await seed({ day: '2026-10-15', gameTypes: ['bridge', 'bigtwo', 'holdem'], wins: 2,
      taskIds: ['play-variety', 'win-two', 'play-bridge'], claimedTasks: [], checkInDays: ['2026-09-30'] });
    await Promise.all(['play-variety', 'win-two', 'check-in', 'win-two'].map((reward) =>
      repository.claimDailyReward(id, reward as DailyRewardId, '2026-10-15')));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 40, coinRevision: 3 });
    expect(await repository.getDailyRewards(id)).toMatchObject({ checkInDays: ['2026-10-15'] });
    now += 1000;
    expect(await repository.getDailyRewards(id)).toMatchObject({ gameTypes: [], wins: 0, claimedTasks: [] });
    await repository.claimDailyReward(id, 'check-in', '2026-10-16');
    await Promise.all([
      repository.purchaseAvatarBorder(id, 'copper', now),
      repository.claimDailyReward(id, 'check-in', '2026-10-16'),
    ]);
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 0, coinRevision: 5, ownedAvatarBorders: ['copper'] });
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

  it('draws three unique stable tasks per account and day, including after restart', async () => {
    const id = await seed();
    const first = (await repository.getDailyRewards(id))!;
    expect(first.tasks).toHaveLength(3);
    expect(new Set(first.tasks.map((task) => task.id)).size).toBe(3);
    expect((await repository.getDailyRewards(id))!.tasks).toEqual(first.tasks);
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect((await repository.getDailyRewards(id))!.tasks).toEqual(first.tasks);
    const unseen = DAILY_TASKS.find((task) => !first.tasks.some((selected) => selected.id === task.id))!;
    await expect(repository.claimDailyReward(id, unseen.id, first.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNASSIGNED' });
    const draws = new Set(Array.from({ length: 12 }, (_, index) => dailyState(undefined, now, `player-${index}`).taskIds.join(',')));
    expect(draws.size).toBeGreaterThan(1);
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
    expect(new Set(changed.tasks.map((task) => task.id)).size).toBe(3);
    expect(changed.tasks.slice(1)).toEqual(first.tasks.slice(1));
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect((await repository.replaceDailyTask(id, from, first.day))!.dailyRewards.tasks).toEqual(changed.tasks);
    await expect(repository.claimDailyReward(id, from, first.day)).rejects.toMatchObject({ code: 'DAILY_TASK_UNASSIGNED' });
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 0 });
    now += 1000;
    expect(await repository.getDailyRewards(id)).toMatchObject({ swapsRemaining: 1, claimedTasks: [] });
    await expect(repository.replaceDailyTask(id, from, first.day)).rejects.toMatchObject({ code: 'DAILY_DATE_CHANGED' });
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
      gameCounts: Object.fromEntries(GAME_TYPES.map((type) => [type, 2])),
      taskIds: [task.id, ...DAILY_TASKS.filter((entry) => entry.id !== task.id).slice(0, 2).map((entry) => entry.id)],
    });
    const status = (await repository.getDailyRewards(id))!;
    expect(status.tasks[0]).toEqual({ id: task.id, progress: task.target });
    await Promise.all(Array.from({ length: 4 }, () => repository.claimDailyReward(id, task.id, status.day)));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: task.coins, coinRevision: 1 });
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
  it('counts completed types once and partnership wins, caps progress, and leaves input immutable', () => {
    const initial = dailyState(undefined, now, 'S');
    const first = dailyGameProgress(initial, bridge, 'S', now);
    const second = dailyGameProgress(first, bridge, 'S', now);
    expect(dailyGameProgress(second, bridge, 'S', now)).toMatchObject({ gameTypes: ['bridge'], wins: 2 });
    expect(dailyGameProgress(initial, bridge, 'E', now).wins).toBe(0);
    expect(initial).toMatchObject({ gameTypes: [], wins: 0 });
    expect(dailyGameProgress(first, bridge, 'S', now + 86_400_000)).toMatchObject({ wins: 1, claimedTasks: [] });
  });
  it('excludes unfinished games, spectators, bots and losses from wins, but counts tied leaders', () => {
    expect(dailyGameProgress(undefined, { ...bridge, result: null }, 'N', now).gameTypes).toEqual([]);
    expect(dailyGameProgress(undefined, bridge, 'spectator', now).gameTypes).toEqual([]);
    expect(dailyGameProgress(undefined, { ...bridge, players: { ...players, N: { ...players.N, isBot: true } } }, 'N', now).gameTypes).toEqual([]);
    const tied: typeof bridge = { gameType: 'redpoints', players,
      result: { gameType: 'redpoints', points: { N: 80, E: 80, S: 24, W: 24 }, winners: ['N', 'E'] } };
    expect(dailyGameProgress(undefined, tied, 'N', now)).toMatchObject({ gameTypes: ['redpoints'], wins: 1 });
    expect(dailyGameProgress(undefined, tied, 'S', now)).toMatchObject({ gameTypes: ['redpoints'], wins: 0 });
    const lastSurvivor: typeof bridge = { gameType: 'ninetynine', players,
      result: { gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 } };
    expect(dailyGameProgress(undefined, lastSurvivor, 'W', now).wins).toBe(1);
    expect(dailyGameProgress(undefined, lastSurvivor, 'N', now).wins).toBe(0);
    expect(dailyGameProgress(undefined, { ...tied, result: { gameType: 'redpoints', points: { N: 80, E: 60, S: 44, W: 24 }, winners: ['N'] } }, 'N', now).wins).toBe(1);
  });
  it('validates dates, progress, and unique durable receipts', () => {
    const state = dailyState(undefined, now, 'S');
    expect(validDailyRewards(state)).toBe(true);
    for (const patch of [{ day: '2026-02-30' }, { wins: -1 }, { wins: 3 }, { gameTypes: ['bridge', 'bridge'] },
      { gameTypes: ['fake'] }, { claimedTasks: ['win-two'] }, { checkInDays: ['2026-10-15', '2026-10-15'] },
      { taskIds: ['win-two', 'win-two', 'play-variety'] }, { taskIds: ['win-two'] }, { taskIds: ['fake', 'win-two', 'play-variety'] },
      { gameCounts: { bridge: -1 } }, { gameCounts: { fake: 1 } }, { replacement: { from: 'fake', to: 'win-two' } }]) {
      expect(validDailyRewards({ ...state, ...patch })).toBe(false);
    }
    expect(dailyDate(Date.parse('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });
  it('increments per-game counts and uses the same daily activity for newly drawn tasks', () => {
    const first = dailyGameProgress(undefined, bridge, 'N', now);
    expect(first.gameCounts).toEqual({ bridge: 1 });
    expect(taskProgress(first, 'play-bridge')).toBe(1);
    expect(taskProgress(first, 'play-bigtwo')).toBe(0);
    const played = { ...first, gameCounts: { ...first.gameCounts, bigtwo: 1, blackjack: 1 } };
    expect(taskProgress(played, 'play-bigtwo')).toBe(1);
    expect(taskProgress(played, 'play-casino')).toBe(1);
    expect(taskProgress({ ...played, gameCounts: { holdem: 1 } }, 'play-casino')).toBe(1);
    expect(taskProgress({ ...played, gameCounts: { stud: 1 } }, 'play-casino')).toBe(1);
  });
});
