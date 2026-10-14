import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import { isShopItemId } from '@shared/constants/shop';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import type { AnyGameState, PlayerInfo, ShopItemId } from '@shared/types';
import { createJsonRepository } from '../../src/database/json-repository';
import { achievementGameProgress, validAchievements } from '../../src/database/achievements';
import type { AchievementsRecord } from '../../src/database/achievements';
import { publicAccount } from '../../src/database/repository';
import type { AccountRecord, Repository } from '../../src/database/repository';
import { seedAuthenticatedAccount } from '../auth/account-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const complete: AchievementsRecord = { games: 20, wins: 5,
  gameTypes: ['bridge', 'bigtwo', 'sevens', 'holdem', 'blackjack'], dailyTasks: 15 };

describe('achievement ownership and progress', () => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let now: number;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'achievements-'));
    path = join(directory, 'database.json');
    now = Date.parse('2026-10-15T15:59:59Z');
    repository = await createJsonRepository(path, { now: () => now });
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
    const before = await readFile(path, 'utf8');
    const status = (await repository.getAchievements(id))!;
    expect(status.categories).toHaveLength(2);
    expect(status.categories.flatMap((category) => category.items)).toHaveLength(8);
    expect(status.categories.every((category) => !category.claimed && category.items.every((item) => item.progress === 0))).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(before);
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
    repository = await createJsonRepository(path, { now: () => now });
    expect(await repository.claimAchievement(id, 'table')).toMatchObject({ account: { nameplate: 'nameplate-table-traveler',
      ownedAchievementNameplates: ['nameplate-table-traveler'], coins: 1000 } });
    expect(await repository.updateProfile(id, { nameplate: null }, now)).toMatchObject({ nameplate: null });
  });

  it('rolls back failed claims and allows retry', async () => {
    const id = await seed({ achievements: complete });
    const before = await readFile(path, 'utf8');
    vi.mocked(rename).mockRejectedValueOnce(new Error('disk full'));
    await expect(repository.claimAchievement(id, 'table')).rejects.toThrow('disk full');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await repository.getAchievements(id))!.categories[0].claimed).toBe(false);
    expect((await repository.claimAchievement(id, 'table'))!.achievements.categories[0].claimed).toBe(true);
  });

  it('keeps cumulative task claims across midnight, counts retries once, and includes old nonconsecutive check-ins', async () => {
    const id = await seed({ achievements: { ...complete, dailyTasks: 14 }, dailyRewards: {
      day: '2026-10-15', gameTypes: ['bridge'], wins: 0, gameCounts: { bridge: 1 }, claimedTasks: [],
      taskIds: ['play-bridge', 'win-two', 'play-variety'],
      checkInDays: ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07', '2026-09-09', '2026-09-11'],
    } });
    vi.mocked(rename).mockRejectedValueOnce(new Error('task write failed'));
    await expect(repository.claimDailyReward(id, 'play-bridge', '2026-10-15')).rejects.toThrow('task write failed');
    expect((await repository.getAccountById(id))!.achievements?.dailyTasks).toBe(14);
    await Promise.all(Array.from({ length: 4 }, () => repository.claimDailyReward(id, 'play-bridge', '2026-10-15')));
    await expect(repository.claimAchievement(id, 'daily')).rejects.toMatchObject({ code: 'ACHIEVEMENT_INCOMPLETE' });
    now += 1000;
    await Promise.all(Array.from({ length: 3 }, () => repository.claimDailyReward(id, 'check-in', '2026-10-16')));
    expect((await repository.getAccountById(id))!.achievements?.dailyTasks).toBe(15);
    expect((await repository.claimAchievement(id, 'daily'))!.account).toMatchObject({ coins: 1025,
      ownedAchievementNameplates: ['nameplate-daily-collector'] });
  });

  it('validates stored counters and inventory', async () => {
    for (const value of [{ ...complete, games: -1 }, { ...complete, wins: 6 }, { ...complete, dailyTasks: 1.5 },
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
  it('counts completed participant games including bots, excludes spectators and incomplete games, and caps counters', () => {
    expect(achievementGameProgress(undefined, game, 'alice')).toEqual({ games: 1, wins: 1, gameTypes: ['bigtwo'], dailyTasks: 0 });
    expect(achievementGameProgress(undefined, game, 'spectator').games).toBe(0);
    expect(achievementGameProgress(undefined, { ...game, result: null }, 'alice').games).toBe(0);
    expect(achievementGameProgress(undefined, { ...game, players: { N: { ...player, isBot: true } } }, 'alice').games).toBe(0);
    expect(achievementGameProgress(complete, game, 'alice')).toEqual(complete);
  });
  it('does not count tied leaders as wins', () => {
    const tied = { ...game, gameType: 'holdem', result: { winners: ['N', 'E'] } } as unknown as typeof game;
    expect(achievementGameProgress(undefined, tied, 'alice')).toMatchObject({ games: 1, wins: 0 });
  });
});
