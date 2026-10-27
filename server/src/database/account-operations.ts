import { GAME_COIN_REWARD, getShopItem, ownsShopItem } from '@shared/constants';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementCategoryId } from '@shared/constants/achievements';
import { DAILY_CHECK_IN_COINS, DAILY_TASKS } from '@shared/constants/daily-rewards';
import type { AchievementsStatus, AnyGameState, DailyRewardId, DailyRewardsStatus, DailyTaskId, ShopItemId } from '@shared/types';
import type { PersistedPlayer } from '../runtime/types';
import { achievementGameProgress, achievementState, achievementsStatus } from './achievements';
import { dailyGameProgress, dailyState, dailyStatus, replacementTask, taskProgress } from './daily-rewards';
import type { AccountRecord, Repository } from './repository';
import { repositoryError } from './repository';
import { equipmentError } from './shop-equipment';

// Account decisions shared by every Repository adapter. Each returns the input account unchanged
// when nothing needs to be written, and throws repository errors for rejected requests.

export type ProfileUpdate = Parameters<Repository['updateProfile']>[1];

export function purchasedAccount(account: AccountRecord, itemId: ShopItemId, now: number): AccountRecord {
  const item = getShopItem(itemId);
  if (!item) throw repositoryError('INVALID_SHOP_ITEM', 'Choose an available shop item.');
  if (ownsShopItem(account, item)) return account;
  if ((account.coins ?? 0) < item.price) {
    throw repositoryError('INSUFFICIENT_COINS', 'Not enough coins. Play more games to earn coins.');
  }
  const inventory = item.type === 'avatarBorder'
    ? { ownedAvatarBorders: [...(account.ownedAvatarBorders ?? []), item.id] }
    : { ownedShopItems: [...(account.ownedShopItems ?? []), item.id] };
  return { ...account, ...inventory,
    coins: (account.coins ?? 0) - item.price,
    coinRevision: (account.coinRevision ?? 0) + 1,
    updatedAt: Math.max(now, account.updatedAt + 1) };
}

export function profileUpdatedAccount(account: AccountRecord, profile: ProfileUpdate, now: number): AccountRecord {
  if (profile.avatarBorder && !account.ownedAvatarBorders?.includes(profile.avatarBorder)) {
    throw repositoryError('BORDER_NOT_OWNED', 'Purchase this avatar border first.');
  }
  const invalidEquipment = equipmentError(profile, account);
  if (invalidEquipment) throw repositoryError(invalidEquipment, 'Choose an owned item for this equipment slot.');
  return { ...account, ...profile, updatedAt: Math.max(now, account.updatedAt + 1) };
}

export function achievementClaim(account: AccountRecord, categoryId: AchievementCategoryId, now: number): {
  account: AccountRecord; achievements: AchievementsStatus;
} {
  const category = ACHIEVEMENT_CATEGORIES.find((entry) => entry.id === categoryId);
  if (!category) throw repositoryError('INVALID_ACHIEVEMENT', 'Choose an achievement category.');
  const status = achievementsStatus(account);
  const progress = status.categories.find((entry) => entry.id === categoryId)!;
  if (progress.claimed) return { account, achievements: status };
  if (!category.items.every((item) => progress.items.some((entry) => entry.id === item.id && entry.progress >= item.target))) {
    throw repositoryError('ACHIEVEMENT_INCOMPLETE', 'Complete every achievement in this category first.');
  }
  const updated: AccountRecord = { ...account,
    ownedAchievementNameplates: [...(account.ownedAchievementNameplates ?? []), category.reward],
    updatedAt: Math.max(now, account.updatedAt + 1) };
  return { account: updated, achievements: achievementsStatus(updated) };
}

export function dailyRewardClaim(account: AccountRecord, reward: DailyRewardId, day: string, timestamp: number): {
  account: AccountRecord; dailyRewards: DailyRewardsStatus;
} {
  const id = account.id;
  const state = dailyState(account.dailyRewards, timestamp, id);
  if (day !== state.day) throw repositoryError('DAILY_DATE_CHANGED', 'Refresh today’s rewards.');
  const task = DAILY_TASKS.find((entry) => entry.id === reward);
  if (!task && reward !== 'check-in') throw repositoryError('INVALID_DAILY_REWARD', 'Choose an available daily reward.');
  const alreadyClaimed = reward === 'check-in' ? state.checkInDays.includes(day)
    : state.claimedTasks.includes(reward);
  if (task && !state.taskIds.includes(task.id)) throw repositoryError('DAILY_TASK_UNASSIGNED', 'This task is not assigned today.');
  if (alreadyClaimed) return { account, dailyRewards: dailyStatus(account.dailyRewards, timestamp, id) };
  if (task && taskProgress(state, task.id) < task.target) {
    throw repositoryError('DAILY_TASK_INCOMPLETE', 'Complete the daily task before claiming.');
  }
  const coins = (account.coins ?? 0) + (task?.coins ?? DAILY_CHECK_IN_COINS);
  if (!Number.isSafeInteger(coins)) throw new Error('Coin balance exceeds the supported limit.');
  const dailyRewards = { ...state,
    checkInDays: reward === 'check-in' ? [...state.checkInDays, day] : state.checkInDays,
    claimedTasks: reward === 'check-in' ? state.claimedTasks : [...state.claimedTasks, reward],
  };
  const updated: AccountRecord = { ...account, dailyRewards, coins,
    achievements: reward === 'check-in' ? account.achievements : {
      ...achievementState(account.achievements), dailyTasks: (account.achievements?.dailyTasks ?? 0) + 1,
    },
    coinRevision: (account.coinRevision ?? 0) + 1, updatedAt: Math.max(timestamp, account.updatedAt + 1) };
  return { account: updated, dailyRewards: dailyStatus(dailyRewards, timestamp, id) };
}

export function dailyTaskReplacement(account: AccountRecord, task: DailyTaskId, day: string, timestamp: number): {
  account: AccountRecord; dailyRewards: DailyRewardsStatus;
} {
  const id = account.id;
  const state = dailyState(account.dailyRewards, timestamp, id);
  if (day !== state.day) throw repositoryError('DAILY_DATE_CHANGED', 'Refresh today’s rewards.');
  if (state.replacement?.from === task) return { account, dailyRewards: dailyStatus(state, timestamp, id) };
  if (state.replacement) throw repositoryError('DAILY_REPLACE_USED', 'Today’s replacement has been used.');
  if (!state.taskIds.includes(task) || state.claimedTasks.includes(task)) {
    throw repositoryError('DAILY_TASK_UNAVAILABLE', 'Choose an assigned, unclaimed task.');
  }
  const to = replacementTask(state, id);
  const dailyRewards = { ...state, taskIds: state.taskIds.map((entry) => entry === task ? to : entry), replacement: { from: task, to } };
  const updated: AccountRecord = { ...account, dailyRewards, updatedAt: Math.max(timestamp, account.updatedAt + 1) };
  return { account: updated, dailyRewards: dailyStatus(dailyRewards, timestamp, id) };
}

/** Coins, achievement counters, and daily progress for one human in a newly completed game. */
export function gameRewardedAccount(account: AccountRecord, game: AnyGameState, rewardedAt: number): AccountRecord {
  const coins = (account.coins ?? 0) + GAME_COIN_REWARD;
  if (!Number.isSafeInteger(coins)) throw new Error('Coin balance exceeds the supported limit.');
  return { ...account, coins, coinRevision: (account.coinRevision ?? 0) + 1,
    achievements: achievementGameProgress(account.achievements, game, account.id),
    dailyRewards: dailyGameProgress(account.dailyRewards, game, account.id, rewardedAt) };
}

/** The completed game a reward is for; throws when it is missing or has no result. */
export function completedGame(games: readonly AnyGameState[], id: string): AnyGameState {
  const game = games.find((entry) => entry.id === id);
  if (!game?.result) throw new Error('Coin rewards require a completed game.');
  return game;
}

/** Human account IDs rewarded for a completed game. */
export function rewardedHumans(game: AnyGameState): Set<string> {
  return new Set(Object.values(game.players).filter((player) => !player.isBot).map((player) => player.id));
}

/** Commit time while connected, otherwise the observed disconnect; null for a restore-only grace period. */
export function observedLastSeen(player: PersistedPlayer, commitTime: number): number | null {
  return player.disconnectedAt === null ? commitTime
    : player.lastSeenAt === undefined ? player.disconnectedAt : player.lastSeenAt;
}
