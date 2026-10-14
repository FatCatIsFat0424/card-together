import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import type { AchievementId } from '@shared/constants/achievements';
import type { AchievementsStatus } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../client/src/api';
import { useAchievementNoticeStore } from '../../../client/src/stores/achievement-notice-store';

function status(ids: readonly AchievementId[]): AchievementsStatus {
  return { categories: ACHIEVEMENT_CATEGORIES.map((category) => ({
    id: category.id, claimed: false,
    items: category.items.map((item) => ({ id: item.id, progress: ids.includes(item.id) ? item.target : 0 })),
  })) };
}

async function receive(ids: readonly AchievementId[]): Promise<void> {
  const response = { success: true as const, achievements: status(ids) };
  vi.mocked(apiRequest).mockResolvedValueOnce(response);
  await useAchievementNoticeStore.getState().refresh();
}

describe('achievement completion notices', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    useAchievementNoticeStore.getState().initialize(null);
    useAchievementNoticeStore.getState().initialize('alice');
  });

  it('uses existing completions as a silent baseline and queues new game and daily achievements', async () => {
    await receive(['first-game']);
    expect(useAchievementNoticeStore.getState().queue).toEqual([]);
    await receive(['first-game', 'five-wins', 'first-check-in', 'three-tasks']);
    expect(useAchievementNoticeStore.getState().queue).toEqual(['five-wins', 'first-check-in', 'three-tasks']);
    useAchievementNoticeStore.getState().dismiss('five-wins');
    expect(useAchievementNoticeStore.getState().queue).toEqual(['first-check-in', 'three-tasks']);
  });

  it('does not repeat notices after duplicate or regressed snapshots and refocus', async () => {
    await receive([]);
    await receive(['first-game']);
    useAchievementNoticeStore.getState().dismiss('first-game');
    await receive([]);
    await receive(['first-game']);
    expect(useAchievementNoticeStore.getState().queue).toEqual([]);
  });

  it('keeps its baseline after failed refreshes', async () => {
    await receive([]);
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: false, error: 'offline', status: 503 });
    await useAchievementNoticeStore.getState().refresh();
    await receive(['first-game']);
    expect(useAchievementNoticeStore.getState().queue).toEqual(['first-game']);
  });

  it('ignores older in-flight responses', async () => {
    await receive([]);
    let resolveOld!: (result: { success: true; achievements: AchievementsStatus }) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const older = useAchievementNoticeStore.getState().refresh();
    await receive(['first-game']);
    resolveOld({ success: true, achievements: status(['five-wins']) });
    await older;
    expect(useAchievementNoticeStore.getState().queue).toEqual(['first-game']);
  });

  it('clears queued notices and rejects responses across account changes, including switching back', async () => {
    await receive([]);
    await receive(['first-game']);
    let resolveOld!: (result: { success: true; achievements: AchievementsStatus }) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const older = useAchievementNoticeStore.getState().refresh();
    useAchievementNoticeStore.getState().initialize('bob');
    expect(useAchievementNoticeStore.getState().queue).toEqual([]);
    useAchievementNoticeStore.getState().initialize('alice');
    resolveOld({ success: true, achievements: status(['first-game', 'five-wins']) });
    await older;
    expect(useAchievementNoticeStore.getState().seen).toBeNull();
    await receive(['first-game', 'five-wins']);
    expect(useAchievementNoticeStore.getState().queue).toEqual([]);
  });
});
