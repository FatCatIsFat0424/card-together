import { PROGRESSION_REWARDS } from '@shared/constants/progression';
import type { ProgressionRewardId } from '@shared/constants/progression';
import { progressionStatus } from '@shared/rules/progression';
import type { GameStats, ProgressionStatus } from '@shared/types';
import type { AccountRecord } from './repository';
import { repositoryError } from './repository';

export function accountProgression(account: AccountRecord, stats: readonly GameStats[]): ProgressionStatus {
  return progressionStatus(account.achievements?.games ?? 0, stats, account.ownedAchievementNameplates ?? []);
}

/** Called inside the adapter's serialized write, with the same committed account and stats. */
export function progressionClaim(account: AccountRecord, stats: readonly GameStats[], rewardId: ProgressionRewardId,
  now: number): { account: AccountRecord; progression: ProgressionStatus } {
  const reward = PROGRESSION_REWARDS.find((entry) => entry.id === rewardId);
  if (!reward) throw repositoryError('INVALID_PROGRESSION_REWARD', 'Choose a progression reward.');
  const progression = accountProgression(account, stats);
  const progress = progression.rewards.find((entry) => entry.id === rewardId)!;
  if (progress.claimed) return { account, progression };
  if (!progress.eligible) throw repositoryError('PROGRESSION_INCOMPLETE', 'Reach this progression target first.');
  const updated: AccountRecord = { ...account,
    ownedAchievementNameplates: [...(account.ownedAchievementNameplates ?? []), reward.nameplate],
    updatedAt: Math.max(now, account.updatedAt + 1) };
  return { account: updated, progression: accountProgression(updated, stats) };
}
