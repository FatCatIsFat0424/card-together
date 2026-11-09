import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESSION_REWARDS } from '@shared/constants/progression';
import type { ProgressionRewardId } from '@shared/constants/progression';
import type { ShopItemId } from '@shared/types';
import { publicAccount } from '../../src/database/repository';
import type { AccountRecord, Repository } from '../../src/database/repository';
import type { GameStatsRecord } from '../../src/database/game-stats';
import { emptyDocument } from '../../src/database/schema';
import { publicProfile } from '../../src/social/friend-service';
import { seedAuthenticatedAccount } from '../auth/account-fixture';
import { REPOSITORY_ADAPTERS } from '../helpers/repository-adapters';
import { account } from '../helpers/storage-fixture';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

describe.each(REPOSITORY_ADAPTERS)('progression storage ($name)', (adapter) => {
  let directory: string;
  let path: string;
  let repository: Repository;
  let now: number;
  const owner: AccountRecord = { ...account('alice'), coins: 1000, coinRevision: 4,
    achievements: { games: 1225, wins: 0, gameTypes: ['bridge'], dailyTasks: 0 },
    ownedShopItems: ['nameplate-aurora'], nameplate: 'nameplate-aurora',
    ownedAchievementNameplates: ['nameplate-table-traveler'] };

  function row(gameType: 'bigtwo' | 'liarsdice', scope: 'human' | 'all', overrides: Partial<GameStatsRecord> = {}): GameStatsRecord {
    return { accountId: owner.id, gameType, scope, version: 1, since: 123, versionSince: {},
      matches: scope === 'all' ? 30 : 5, wins: 0, ties: 0, ranks: [], tables: {},
      counts: scope === 'all' ? { fullHouses: 5, callsWon: 5, bidsHeld: 5 } : {}, sums: {}, best: {}, latest: {},
      streak: { current: 0, best: 0 }, logged: scope === 'all' ? 30 : 5, logSince: 234, lastAt: 500, ...overrides };
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'progression-'));
    path = join(directory, adapter.fileName);
    now = 1000;
    await adapter.seed(path, { ...emptyDocument(), accounts: [owner], gameStats: [
      row('bigtwo', 'human'), row('liarsdice', 'human'), row('bigtwo', 'all'), row('liarsdice', 'all'),
    ] });
    repository = await adapter.open(path, { now: () => now });
  });
  afterEach(async () => {
    vi.mocked(rename).mockClear();
    await repository.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('derives old totals without writes and reads only the owner all-scope rows', async () => {
    const before = await adapter.persisted(path);
    const status = (await repository.getProgression(owner.id))!;
    expect(status.level).toMatchObject({ level: 50, games: 1225, totalXp: '122500' });
    expect(status.familiarity).toEqual([
      { gameType: 'bigtwo', games: 30, stage: 4, nextTarget: 60, since: 123 },
      { gameType: 'liarsdice', games: 30, stage: 4, nextTarget: 60, since: 123 },
    ]);
    expect(status.stamps).toBe(6);
    expect(status.collection.find((entry) => entry.id === 'bigtwo.fullHouses')).toMatchObject({ count: 5, since: 234 });
    expect(status.rewards.every((entry) => entry.eligible && !entry.claimed)).toBe(true);
    expect(await adapter.persisted(path)).toBe(before);
    const other = await seedAuthenticatedAccount(repository, 'bob');
    const otherStatus = (await repository.getProgression(other.account.id))!;
    expect(otherStatus.level).toMatchObject({ level: 1, games: 0, totalXp: '0' });
    expect(otherStatus.collection.every((entry) => entry.count === null && !entry.tracked && entry.since === null)).toBe(true);
    expect(await repository.getProgression('missing')).toBeNull();
    expect(await repository.claimProgression('missing', 'level-5')).toBeNull();
    for (const profile of [publicAccount(owner), publicProfile(owner)]) {
      for (const field of ['achievements', 'progression', 'totalXp', 'gameStats', 'passwordHash']) {
        expect(profile).not.toHaveProperty(field);
      }
    }
    expect(publicProfile(owner)).not.toHaveProperty('ownedAchievementNameplates');
  });

  it('rejects invalid and incomplete claims, buying and equipping unearned rewards', async () => {
    const unqualified = await seedAuthenticatedAccount(repository, 'bob');
    for (const reward of PROGRESSION_REWARDS) {
      await expect(repository.claimProgression(unqualified.account.id, reward.id)).rejects.toMatchObject({ code: 'PROGRESSION_INCOMPLETE' });
      await expect(repository.purchaseShopItem(owner.id, reward.nameplate as ShopItemId, now))
        .rejects.toMatchObject({ code: 'INVALID_SHOP_ITEM' });
      await expect(repository.updateProfile(owner.id, { nameplate: reward.nameplate }, now))
        .rejects.toMatchObject({ code: 'SHOP_ITEM_NOT_OWNED' });
    }
    await expect(repository.claimProgression(owner.id, 'level-1' as ProgressionRewardId))
      .rejects.toMatchObject({ code: 'INVALID_PROGRESSION_REWARD' });
    expect(await repository.getAccountById(owner.id)).toMatchObject({ coins: 1000, coinRevision: 4,
      ownedAchievementNameplates: ['nameplate-table-traveler'] });
  });

  it('grants every title once under concurrent retries, preserves equipment and coins, and survives restart', async () => {
    await Promise.all(PROGRESSION_REWARDS.flatMap((reward) =>
      Array.from({ length: 4 }, () => repository.claimProgression(owner.id, reward.id))));
    const saved = (await repository.getAccountById(owner.id))!;
    expect(saved).toMatchObject({ coins: 1000, coinRevision: 4, nameplate: 'nameplate-aurora',
      ownedShopItems: ['nameplate-aurora'], achievements: owner.achievements, updatedAt: 1016 });
    expect(saved.ownedAchievementNameplates).toHaveLength(18);
    expect(new Set(saved.ownedAchievementNameplates).size).toBe(18);
    expect((await repository.getProgression(owner.id))!.rewards.every((entry) => entry.claimed)).toBe(true);
    await repository.updateProfile(owner.id, { nameplate: 'nameplate-record-curator' }, now);
    await repository.close();
    now += 5000;
    repository = await adapter.open(path, { now: () => now });
    const before = (await repository.getAccountById(owner.id))!;
    await repository.claimProgression(owner.id, 'collection-6');
    expect(await repository.getAccountById(owner.id)).toEqual(before);
    expect(before.nameplate).toBe('nameplate-record-curator');
    expect((await repository.updateProfile(owner.id, { nameplate: null }, now))!.nameplate).toBeNull();
  });

  it('rolls back a failed durable grant and allows a clean concurrent retry', async () => {
    const before = await adapter.persisted(path);
    adapter.failNextCommit(new Error('disk full'));
    await expect(repository.claimProgression(owner.id, 'collection-6')).rejects.toThrow('disk full');
    expect(await adapter.persisted(path)).toBe(before);
    expect((await repository.getProgression(owner.id))!.rewards.find((entry) => entry.id === 'collection-6')!.claimed).toBe(false);
    await Promise.all(Array.from({ length: 4 }, () => repository.claimProgression(owner.id, 'collection-6')));
    expect((await repository.getAccountById(owner.id))!.ownedAchievementNameplates)
      .toEqual(['nameplate-table-traveler', 'nameplate-record-curator']);
  });

  it('does not count human-only rows toward familiarity or collection rewards', async () => {
    await repository.claimProgression(owner.id, 'bigtwo-30');
    const grantedAt = (await repository.getAccountById(owner.id))!.updatedAt;
    await repository.close();
    const document = await adapter.readDocument(path);
    await adapter.writeUnchecked(path, { ...document, gameStats: [row('bigtwo', 'human', { matches: 60,
      logged: 60, counts: { fullHouses: 20 } }), row('bigtwo', 'all', { matches: 1, logged: 0, counts: {} })] });
    repository = await adapter.open(path, { now: () => now });
    const status = (await repository.getProgression(owner.id))!;
    expect(status.familiarity[0]).toMatchObject({ games: 1, stage: 1 });
    expect(status.stamps).toBe(0);
    expect(status.collection.find((entry) => entry.id === 'bigtwo.fullHouses')).toMatchObject({ count: null, tracked: false });
    await expect(repository.claimProgression(owner.id, 'bigtwo-5')).rejects.toMatchObject({ code: 'PROGRESSION_INCOMPLETE' });
    await expect(repository.claimProgression(owner.id, 'collection-1')).rejects.toMatchObject({ code: 'PROGRESSION_INCOMPLETE' });
    expect((await repository.claimProgression(owner.id, 'bigtwo-30'))!.progression.rewards
      .find((entry) => entry.id === 'bigtwo-30')).toEqual({ id: 'bigtwo-30', eligible: false, claimed: true });
    expect((await repository.getAccountById(owner.id))!.updatedAt).toBe(grantedAt);
  });

  it('retains exact lifetime XP from maximum existing safe game totals without a separate XP counter', async () => {
    const seeded = await seedAuthenticatedAccount(repository, 'legacy', { achievements: {
      games: Number.MAX_SAFE_INTEGER, wins: 0, gameTypes: ['bridge'], dailyTasks: 0,
    } });
    expect((await repository.getProgression(seeded.account.id))!.level).toEqual({ level: 50,
      games: Number.MAX_SAFE_INTEGER, totalXp: '900719925474099100',
      currentLevelXp: 0, nextLevelXp: null, gamesToNextLevel: null });
    const claimed = (await repository.claimProgression(seeded.account.id, 'level-50'))!;
    expect(claimed.account.achievements!.games).toBe(Number.MAX_SAFE_INTEGER);
    expect(claimed.account).not.toHaveProperty('totalXp');
    expect(claimed.account).not.toHaveProperty('progression');
  });
});
