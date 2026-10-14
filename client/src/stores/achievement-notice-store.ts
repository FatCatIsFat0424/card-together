import { create } from 'zustand';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import type { AchievementsStatus } from '@shared/types';
import { apiRequest } from '../api';

interface AchievementNoticeStore {
  accountId: string | null;
  seen: readonly AchievementId[] | null;
  queue: readonly AchievementId[];
  initialize: (accountId: string | null) => void;
  refresh: () => Promise<void>;
  dismiss: (id: AchievementId) => void;
}

let requestVersion = 0;

export const useAchievementNoticeStore = create<AchievementNoticeStore>((set, get) => ({
  accountId: null, seen: null, queue: [],
  initialize: (accountId) => {
    if (accountId === get().accountId) return;
    ++requestVersion;
    set({ accountId, seen: null, queue: [] });
  },
  refresh: async () => {
    if (!get().accountId) return;
    const version = ++requestVersion;
    const result = await apiRequest<{ achievements: AchievementsStatus }>('/api/auth/achievements');
    if (version !== requestVersion || !result.success) return;
    const completed = ACHIEVEMENT_CATEGORIES.flatMap((category) => {
      const status = result.achievements.categories.find((entry) => entry.id === category.id);
      return category.items.filter((item) => status?.items.some((entry) =>
        entry.id === item.id && entry.progress >= item.target)).map((item) => item.id);
    });
    set((state) => ({
      // The first successful snapshot establishes a baseline, never a backlog.
      queue: state.seen === null ? [] : [...state.queue, ...completed.filter((id) => !state.seen!.includes(id))],
      seen: [...new Set([...(state.seen ?? []), ...completed])],
    }));
  },
  dismiss: (id) => set((state) => ({ queue: state.queue.filter((entry) => entry !== id) })),
}));
