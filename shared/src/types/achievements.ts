import type { AchievementCategoryId, AchievementId } from '../constants/achievements';

export interface AchievementsStatus {
  readonly categories: readonly {
    readonly id: AchievementCategoryId;
    readonly claimed: boolean;
    readonly items: readonly { readonly id: AchievementId; readonly progress: number }[];
  }[];
}
