import { describe, expect, it } from 'vitest';
import {
  EXPERIENCE_PER_GAME, FAMILIARITY_TARGETS, MAX_PLAYER_LEVEL, PROGRESSION_REWARDS, isProgressionRewardId,
} from '@shared/constants/progression';
import { ACHIEVEMENT_NAMEPLATES, isShopItemId } from '@shared/constants/shop';
import { progressionStatus } from '@shared/rules/progression';
import type { GameStats, GameType } from '@shared/types';

function stats(gameType: GameType, overrides: Partial<GameStats> = {}): GameStats {
  return { gameType, version: 1, since: null, versionSince: {}, matches: 60, wins: 0, ties: 0, ranks: [],
    tables: {}, counts: {}, sums: {}, best: {}, latest: {}, streak: { current: 0, best: 0 },
    logged: 60, logSince: null, lastAt: 1000, ...overrides };
}

describe('player progression', () => {
  it('starts at level one and advances at every exact triangular boundary', () => {
    expect(progressionStatus(0, [], []).level).toEqual({ level: 1, games: 0, totalXp: '0',
      currentLevelXp: 0, nextLevelXp: 100, gamesToNextLevel: 1 });
    expect(EXPERIENCE_PER_GAME).toBe(100);
    expect(MAX_PLAYER_LEVEL).toBe(50);
    for (let level = 2; level <= MAX_PLAYER_LEVEL; level++) {
      const games = level * (level - 1) / 2;
      expect(progressionStatus(games - 1, [], []).level).toMatchObject({ level: level - 1,
        currentLevelXp: (level - 2) * 100, nextLevelXp: (level - 1) * 100, gamesToNextLevel: 1 });
      expect(progressionStatus(games, [], []).level).toMatchObject({ level, currentLevelXp: 0,
        nextLevelXp: level === 50 ? null : level * 100, gamesToNextLevel: level === 50 ? null : level });
    }
    expect(progressionStatus(14, [], []).level).toMatchObject({ level: 5, currentLevelXp: 400, gamesToNextLevel: 1 });
  });

  it('caps only the level and preserves exact lifetime XP for old and maximum safe totals', () => {
    for (const games of [1225, 1226, 1_000_000, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
      const status = progressionStatus(games, [], []);
      expect(status.level).toEqual({ level: 50, games, totalXp: (BigInt(games) * 100n).toString(),
        currentLevelXp: 0, nextLevelXp: null, gamesToNextLevel: null });
      expect(JSON.parse(JSON.stringify(status))).toEqual(status);
    }
    expect(progressionStatus(Number.MAX_SAFE_INTEGER, [], []).level.totalXp).toBe('900719925474099100');
    for (const games of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      expect(() => progressionStatus(games, [], [])).toThrow(RangeError);
    }
  });

  it('uses per-game matches for all five familiarity stages and ignores other games', () => {
    expect(FAMILIARITY_TARGETS).toEqual([1, 5, 15, 30, 60]);
    for (const [stage, games] of [0, 1, 5, 15, 30, 60].entries()) {
      const rows = [stats('bigtwo', { matches: games, since: 123 }), stats('bridge', { matches: 999 })];
      const status = progressionStatus(0, rows, []);
      expect(status.familiarity).toEqual([
        { gameType: 'bigtwo', games, stage, nextTarget: FAMILIARITY_TARGETS[stage] ?? null, since: 123 },
        { gameType: 'liarsdice', games: 0, stage: 0, nextTarget: 1, since: null },
      ]);
      expect(status.level.games).toBe(0);
      expect(status.rewards.find((entry) => entry.id === 'bigtwo-5')!.eligible).toBe(games >= 5);
      expect(status.rewards.find((entry) => entry.id === 'bigtwo-30')!.eligible).toBe(games >= 30);
    }
  });

  it('earns six and nine common stamps without any rare record', () => {
    for (const [count, stamps] of [[0, 0], [1, 3], [4, 3], [5, 6], [19, 6], [20, 9], [100, 9]]) {
      const status = progressionStatus(0, [stats('bigtwo', { counts: { fullHouses: count } }),
        stats('liarsdice', { counts: { callsWon: count, bidsHeld: count } })], []);
      expect(status.stamps).toBe(stamps);
      expect(status.collection.filter((entry) => entry.rare).every((entry) => entry.count === 0)).toBe(true);
      for (const target of [1, 3, 6]) {
        expect(status.rewards.find((entry) => entry.id === `collection-${target}`)!.eligible).toBe(stamps >= target);
      }
    }
  });

  it('unlocks rare entries separately without contributing common stamps', () => {
    const status = progressionStatus(0, [stats('bigtwo', { counts: { dragons: 1, straightFlushes: 1, fourOfAKinds: 20 } }),
      stats('liarsdice', { counts: { exactBids: 5 } })], []);
    expect(status.stamps).toBe(0);
    expect(status.collection.filter((entry) => entry.rare).map((entry) => entry.stamps)).toEqual([1, 1, 1, 1]);
    expect(status.rewards.filter((entry) => entry.id.startsWith('collection-')).every((entry) => !entry.eligible)).toBe(true);
  });

  it('distinguishes missing coverage from tracked zero and uses only actual coverage dates', () => {
    expect(progressionStatus(0, [], []).collection.every((entry) => entry.count === null && !entry.tracked
      && entry.since === null && entry.stamps === 0)).toBe(true);
    const status = progressionStatus(0, [stats('bigtwo', { logged: 0, counts: { fullHouses: 99, dragons: 2 },
      since: 100, logSince: null, versionSince: { '1': 200 } })], []);
    expect(status.collection.find((entry) => entry.id === 'bigtwo.fullHouses')).toMatchObject({ count: null,
      tracked: false, stamps: 0, since: 200 });
    expect(status.collection.find((entry) => entry.id === 'bigtwo.dragons')).toMatchObject({ count: 2, tracked: true, since: 200 });
    for (const [since, logSince, versionSince, expected] of [[100, 200, 300, 300], [300, 200, 100, 300],
      [100, 300, 200, 300]] as const) {
      const covered = progressionStatus(0, [stats('bigtwo', { since, logSince, versionSince: { '1': versionSince } })], []);
      expect(covered.collection.find((entry) => entry.id === 'bigtwo.fullHouses')).toMatchObject({ count: 0,
        tracked: true, since: expected });
    }
    const oldVersion = progressionStatus(0, [stats('liarsdice', { version: 0 })], []);
    expect(oldVersion.collection.filter((entry) => entry.gameType === 'liarsdice')
      .every((entry) => entry.count === null && !entry.tracked && entry.since === null)).toBe(true);
  });

  it('keeps seventeen unique earned rewards separate from shop products and legacy rewards', () => {
    expect(PROGRESSION_REWARDS).toHaveLength(17);
    expect(new Set(PROGRESSION_REWARDS.map((entry) => entry.id)).size).toBe(17);
    expect(new Set(PROGRESSION_REWARDS.map((entry) => entry.nameplate)).size).toBe(17);
    expect(ACHIEVEMENT_NAMEPLATES).toHaveLength(19);
    expect(ACHIEVEMENT_NAMEPLATES.slice(0, 2)).toEqual([{ id: 'nameplate-table-traveler' }, { id: 'nameplate-daily-collector' }]);
    const rows = [stats('bigtwo', { counts: { fullHouses: 20 } }), stats('liarsdice', { counts: { callsWon: 20, bidsHeld: 20 } })];
    const before = structuredClone(rows);
    const status = progressionStatus(1225, rows, PROGRESSION_REWARDS.map((entry) => entry.nameplate));
    expect(status.rewards.every((entry) => entry.eligible && entry.claimed)).toBe(true);
    expect(rows).toEqual(before);
    for (const reward of PROGRESSION_REWARDS) {
      expect(isProgressionRewardId(reward.id)).toBe(true);
      expect(isShopItemId(reward.nameplate)).toBe(false);
    }
    for (const invalid of ['level-1', 'nameplate-level-5', '', null, {}, 5]) expect(isProgressionRewardId(invalid)).toBe(false);
    expect(progressionStatus(0, [], ['nameplate-level-5']).rewards[0]).toEqual({ id: 'level-5', eligible: false, claimed: true });
  });
});
