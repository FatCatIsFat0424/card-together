import type { GameType } from './room';
import type { DAILY_TASKS } from '../constants/daily-rewards';

export type DailyTaskId = typeof DAILY_TASKS[number]['id'];
export type DailyRewardId = DailyTaskId | 'check-in';

export interface DailyTaskStatus {
  readonly id: DailyTaskId;
  readonly progress: number;
  /** Drawn from the games this account played most in the 14 days before today. */
  readonly favorite?: true;
  /** Unclaimed, not started, and today's free replacement is unused. */
  readonly replaceable: boolean;
}

export interface DailyRewardsStatus {
  /** Server date in Asia/Taipei, YYYY-MM-DD. */
  readonly day: string;
  readonly serverTime: number;
  readonly resetsAt: number;
  readonly gameTypes: readonly GameType[];
  readonly wins: number;
  readonly claimedTasks: readonly DailyTaskId[];
  /** In slot order: any-game play, win or variety, then a recent favorite game (or another play task). */
  readonly tasks: readonly DailyTaskStatus[];
  readonly swapsRemaining: number;
  /** Checked-in dates within the current calendar month. */
  readonly checkInDays: readonly string[];
}
