import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressionStatus } from '@shared/types';
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../../client/src/api';
import { useProgressionNoticeStore } from '../../../client/src/stores/progression-notice-store';

function status(level = 1, stamps = 0, bigtwoStage = 0, diceStage = 0): ProgressionStatus {
  return { level: { level, games: 0, totalXp: '0', currentLevelXp: 0, nextLevelXp: 100, gamesToNextLevel: 1 },
    familiarity: [
      { gameType: 'bigtwo', games: 0, stage: bigtwoStage, nextTarget: 1, since: null },
      { gameType: 'liarsdice', games: 0, stage: diceStage, nextTarget: 1, since: null },
    ], collection: [], stamps, rewards: [] };
}

async function receive(progress: ProgressionStatus): Promise<void> {
  const response = { success: true as const, progression: progress };
  vi.mocked(apiRequest).mockResolvedValueOnce(response);
  await useProgressionNoticeStore.getState().refresh();
}

describe('progression completion notices', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    useProgressionNoticeStore.getState().initialize(null);
    useProgressionNoticeStore.getState().initialize('alice');
  });

  it('silently adopts existing progress and prioritizes one level, collection, then familiarity summary', async () => {
    await receive(status(5, 2, 1));
    expect(useProgressionNoticeStore.getState().queue).toEqual([]);
    await receive(status(6, 3, 2));
    expect(useProgressionNoticeStore.getState().queue).toEqual([{ id: 'level:6', kind: 'level', level: 6 }]);
    useProgressionNoticeStore.getState().dismiss('level:6');
    await receive(status(6, 5, 3));
    expect(useProgressionNoticeStore.getState().queue).toEqual([{ id: 'collection:5', kind: 'collection', stamps: 2 }]);
    useProgressionNoticeStore.getState().dismiss('collection:5');
    await receive(status(6, 5, 3, 1));
    expect(useProgressionNoticeStore.getState().queue).toEqual([
      { id: 'familiarity:liarsdice:1', kind: 'familiarity', gameType: 'liarsdice', stage: 1 },
    ]);
  });

  it('retains high-water marks after duplicate or regressed responses and failed refreshes', async () => {
    await receive(status(2, 1, 1));
    vi.mocked(apiRequest).mockResolvedValueOnce({ success: false, error: 'offline', status: 503 });
    await useProgressionNoticeStore.getState().refresh();
    await receive(status());
    await receive(status(2, 1, 1));
    expect(useProgressionNoticeStore.getState().queue).toEqual([]);
    await receive(status(2, 2, 1));
    expect(useProgressionNoticeStore.getState().queue[0]).toMatchObject({ kind: 'collection', stamps: 1 });
  });

  it('ignores older in-flight responses', async () => {
    await receive(status());
    let resolveOld!: (response: { success: true; progression: ProgressionStatus }) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const older = useProgressionNoticeStore.getState().refresh();
    await receive(status(2));
    resolveOld({ success: true, progression: status(10, 9, 5, 5) });
    await older;
    expect(useProgressionNoticeStore.getState().queue).toEqual([{ id: 'level:2', kind: 'level', level: 2 }]);
  });

  it('clears queues and discards pending responses even when switching away and back', async () => {
    await receive(status());
    await receive(status(2));
    let resolveOld!: (response: { success: true; progression: ProgressionStatus }) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const older = useProgressionNoticeStore.getState().refresh();
    useProgressionNoticeStore.getState().initialize('bob');
    useProgressionNoticeStore.getState().initialize('alice');
    resolveOld({ success: true, progression: status(3) });
    await older;
    expect(useProgressionNoticeStore.getState()).toMatchObject({ seen: null, queue: [] });
    await receive(status(3));
    expect(useProgressionNoticeStore.getState().queue).toEqual([]);
  });

  it('does not make owner requests while signed out', async () => {
    useProgressionNoticeStore.getState().initialize(null);
    await useProgressionNoticeStore.getState().refresh();
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
