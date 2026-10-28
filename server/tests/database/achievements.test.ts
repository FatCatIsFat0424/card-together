import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import { isShopItemId } from '@shared/constants/shop';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import type { AnyGameState, PlayerInfo, ShopItemId } from '@shared/types';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { achievementGameProgress, validAchievements } from '../../src/database/achievements';
import type { AchievementsRecord } from '../../src/database/achievements';
import { publicAccount } from '../../src/database/repository';
import type { AccountRecord, Repository } from '../../src/database/repository';
import { seedAuthenticatedAccount } from '../auth/account-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const complete: AchievementsRecord = { games: 1000, wins: 250,
  gameTypes: ['bridge', 'bigtwo', 'sevens', 'holdem', 'blackjack'], dailyTasks: 15 };

describe.each(REPOSITORY_ADAPTERS)('achievement ownership and progress ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let now: number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'achievements-'));
    path = join(directory, adapter.fileName);
    now = Date.parse('2026-10-15T15:59:59Z');
    repository = await adapter.open(path, { now: () => now });
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function seed(overrides: Partial<AccountRecord> = {}): Promise<string> {
    return (await seedAuthenticatedAccount(repository, 'alice', { coins: 1000, ...overrides }, { now })).account.id;
  }

  it('reads older accounts without writing and keeps private counters out of profile data', async () => {
    const id = await seed();
    const before = await adapter.persisted(path);
    const status = (await repository.getAchievements(id))!;
    expect(status.categories).toHaveLength(2);
    expect(status.categories.flatMap((category) => category.items)).toHaveLength(23);
    expect(status.categories.every((category) => !category.claimed && category.items.every((item) => item.progress === 0))).toBe(true);
    expect(await adapter.persisted(path)).toBe(before);
    expect(await repository.getAchievements('missing')).toBeNull();
    expect(publicAccount({ ...(await repository.getAccountById(id))!, achievements: complete })).not.toHaveProperty('achievements');
  });

  it('requires all items, rejects unknown categories and prevents buying or equipping unearned titles', async () => {
    const id = await seed({ achievements: { ...complete, wins: 4 } });
    await expect(repository.claimAchievement(id, 'table')).rejects.toMatchObject({ code: 'ACHIEVEMENT_INCOMPLETE' });
    await expect(repository.claimAchievement(id, 'fake' as AchievementCategoryId)).rejects.toMatchObject({ code: 'INVALID_ACHIEVEMENT' });
    for (const category of ACHIEVEMENT_CATEGORIES) {
      expect(isShopItemId(category.reward)).toBe(false);
      await expect(repository.purchaseShopItem(id, category.reward as ShopItemId, now)).rejects.toMatchObject({ code: 'INVALID_SHOP_ITEM' });
      await expect(repository.updateProfile(id, { nameplate: category.reward }, now)).rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
    }
    expect((await repository.getAccountById(id))!.coins).toBe(1000);
  });

  it('grants one permanent title under concurrent claims, keeps coins and equipped title, survives restart and equips', async () => {
    const id = await seed({ achievements: complete, ownedShopItems: ['nameplate-aurora'], nameplate: 'nameplate-aurora' });
    await Promise.all(Array.from({ length: 8 }, () => repository.claimAchievement(id, 'table')));
    expect(await repository.getAccountById(id)).toMatchObject({ coins: 1000, nameplate: 'nameplate-aurora',
      ownedAchievementNameplates: ['nameplate-table-traveler'], ownedShopItems: ['nameplate-aurora'] });
    await repository.updateProfile(id, { nameplate: 'nameplate-table-traveler' }, now);
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect(await repository.claimAchievement(id, 'table')).toMatchObject({ account: { nameplate: 'nameplate-table-traveler',
      ownedAchievementNameplates: ['nameplate-table-traveler'], coins: 1000 } });
    expect(await repository.updateProfile(id, { nameplate: null }, now)).toMatchObject({ nameplate: null });
  });

  it('rolls back failed claims and allows retry', async () => {
    const id = await seed({ achievements: complete });
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('disk full'));
    await expect(repository.claimAchievement(id, 'table')).rejects.toThrow('disk full');
    expect(await adapter.persisted(path)).toBe(before);
    expect((await repository.getAchievements(id))!.categories[0].claimed).toBe(false);
    expect((await repository.claimAchievement(id, 'table'))!.achievements.categories[0].claimed).toBe(true);
  });

  it('keeps cumulative task claims across midnight, counts retries once, and includes old nonconsecutive check-ins', async () => {
    const id = await seed({ achievements: { ...complete, dailyTasks: 269 }, dailyRewards: {
      day: '2026-10-15', gameTypes: ['bridge'], wins: 0, gameCounts: { bridge: 1 }, claimedTasks: [],
      taskIds: ['play-bridge', 'win-two', 'play-variety'],
      checkInDays: Array.from({ length: 179 }, (_, index) =>
        new Date(Date.UTC(2025, 0, 1 + index * 2)).toISOString().slice(0, 10)),
    } });
    adapter.failNextCommit(new Error('task write failed'));
    await expect(repository.claimDailyReward(id, 'play-bridge', '2026-10-15')).rejects.toThrow('task write failed');
    expect((await repository.getAccountById(id))!.achievements?.dailyTasks).toBe(269);
    await Promise.all(Array.from({ length: 4 }, () => repository.claimDailyReward(id, 'play-bridge', '2026-10-15')));
    await expect(repository.claimAchievement(id, 'daily')).rejects.toMatchObject({ code: 'ACHIEVEMENT_INCOMPLETE' });
    now += 1000;
    await Promise.all(Array.from({ length: 3 }, () => repository.claimDailyReward(id, 'check-in', '2026-10-16')));
    expect((await repository.getAccountById(id))!.achievements?.dailyTasks).toBe(270);
    expect((await repository.claimAchievement(id, 'daily'))!.account).toMatchObject({ coins: 1025,
      ownedAchievementNameplates: ['nameplate-daily-collector'] });
    await repository.close();
    repository = await adapter.open(path, { now: () => now });
    expect((await repository.getAchievements(id))!.categories[1]).toMatchObject({ claimed: true,
      items: expect.arrayContaining([{ id: 'half-year-check-ins', progress: 180 }, { id: 'two-seventy-tasks', progress: 270 }]) });
  });

  it('validates stored counters and inventory', async () => {
    for (const value of [{ ...complete, games: -1 }, { ...complete, wins: 1001 },
      { ...complete, games: Number.MAX_SAFE_INTEGER + 1 }, { ...complete, dailyTasks: 1.5 },
      { ...complete, gameTypes: ['bridge', 'bridge'] }, { ...complete, gameTypes: ['fake'] }]) {
      expect(validAchievements(value)).toBe(false);
    }
    await expect(seed({ ownedAchievementNameplates: ['fake'] } as unknown as Partial<AccountRecord>)).rejects.toThrow();
  });
});

describe('achievement game counting', () => {
  const player: PlayerInfo = { id: 'alice', username: 'alice', nickname: 'Alice', color: '#123456', avatar: 'cat', avatarImage: null };
  const game: Pick<AnyGameState, 'players' | 'gameType' | 'result'> = {
    gameType: 'bigtwo', players: { N: player }, result: { gameType: 'bigtwo', winnerSeat: 'N', dragon: false,
      cardsLeft: { N: 0, E: 1, S: 2, W: 3 }, twosLeft: { N: 0, E: 0, S: 0, W: 0 }, scores: { N: 0, E: 1, S: 2, W: 3 } },
  };
  it('counts completed participant games including bots, excludes spectators and incomplete games, and retains totals beyond targets', () => {
    expect(achievementGameProgress(undefined, game, 'alice')).toEqual({ games: 1, wins: 1, gameTypes: ['bigtwo'], dailyTasks: 0 });
    expect(achievementGameProgress(undefined, game, 'spectator').games).toBe(0);
    expect(achievementGameProgress(undefined, { ...game, result: null }, 'alice').games).toBe(0);
    expect(achievementGameProgress(undefined, { ...game, players: { N: { ...player, isBot: true } } }, 'alice').games).toBe(0);
    expect(achievementGameProgress(complete, game, 'alice')).toEqual({ ...complete, games: 1001, wins: 251 });
    const withBot = { ...game, players: { ...game.players, E: { ...player, id: 'bot:opponent', isBot: true } } };
    expect(achievementGameProgress({ ...complete, games: 99, wins: 49 }, withBot, 'alice'))
      .toMatchObject({ games: 100, wins: 50 });
  });
  it('counts tied leaders as wins, and a Napoleon-side partner but not a defender', () => {
    const tied = { ...game, gameType: 'holdem', players: { N: player, E: { ...player, id: 'bob' } },
      result: { gameType: 'holdem', seats: ['N', 'E'], chips: { N: 1000, E: 1000, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 },
        hands: 20, winners: ['N', 'E'], eliminationOrder: [] } } as unknown as typeof game;
    expect(achievementGameProgress(undefined, tied, 'alice')).toMatchObject({ games: 1, wins: 1 });
    expect(achievementGameProgress(undefined, tied, 'bob')).toMatchObject({ games: 1, wins: 1 });
    const napoleon = { ...game, gameType: 'napoleon', players: { N: player, E: { ...player, id: 'bob' }, S: { ...player, id: 'cy' } },
      result: { gameType: 'napoleon', seats: ['N', 'E', 'S'], contract: { level: 13, suit: 'hearts', napoleon: 'N' },
        secretarySeat: 'E', winners: ['N', 'E'], napoleonWins: true } } as unknown as typeof game;
    expect(['alice', 'bob', 'cy'].map((id) => achievementGameProgress(undefined, napoleon, id).wins)).toEqual([1, 1, 0]);
  });
});
