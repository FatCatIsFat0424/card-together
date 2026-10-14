import type { GameType } from './room';
import type { DAILY_TASKS } from '../constants/daily-rewards';

export type DailyTaskId = typeof DAILY_TASKS[number]['id'];
export type DailyRewardId = DailyTaskId | 'check-in';

export interface DailyRewardsStatus {
  /** Server date in Asia/Taipei, YYYY-MM-DD. */
  readonly day: string;
  readonly serverTime: number;
  readonly resetsAt: number;
  readonly gameTypes: readonly GameType[];
  readonly wins: number;
  readonly claimedTasks: readonly DailyTaskId[];
  readonly tasks: readonly { readonly id: DailyTaskId; readonly progress: number }[];
  readonly swapsRemaining: number;
  /** Checked-in dates within the current calendar month. */
  readonly checkInDays: readonly string[];
}
