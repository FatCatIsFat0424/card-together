import { create } from 'zustand';
import type { ProgressionGameType } from '@shared/constants/progression';
import type { ProgressionStatus } from '@shared/types';
import { apiRequest } from '../api';

export type ProgressionNotice =
  | { readonly id: string; readonly kind: 'level'; readonly level: number }
  | { readonly id: string; readonly kind: 'collection'; readonly stamps: number }
  | { readonly id: string; readonly kind: 'familiarity'; readonly gameType: ProgressionGameType; readonly stage: number };

interface ProgressionBaseline {
  readonly level: number;
  readonly stamps: number;
  readonly stages: Readonly<Partial<Record<ProgressionGameType, number>>>;
}

interface ProgressionNoticeStore {
  accountId: string | null;
  seen: ProgressionBaseline | null;
  queue: readonly ProgressionNotice[];
  initialize: (accountId: string | null) => void;
  refresh: () => Promise<void>;
  dismiss: (id: string) => void;
}

let requestVersion = 0;

/** Keep high-water marks so an older snapshot cannot replay a completion notice. */
function baseline(progress: ProgressionStatus, previous: ProgressionBaseline | null): ProgressionBaseline {
  const stages = { ...previous?.stages };
  for (const entry of progress.familiarity) stages[entry.gameType] = Math.max(stages[entry.gameType] ?? 0, entry.stage);
  return { level: Math.max(previous?.level ?? 1, progress.level.level),
    stamps: Math.max(previous?.stamps ?? 0, progress.stamps), stages };
}

function nextNotice(previous: ProgressionBaseline, next: ProgressionBaseline): ProgressionNotice | null {
  if (next.level > previous.level) return { id: `level:${next.level}`, kind: 'level', level: next.level };
  if (next.stamps > previous.stamps) return { id: `collection:${next.stamps}`, kind: 'collection', stamps: next.stamps - previous.stamps };
  const gameType = (Object.keys(next.stages) as ProgressionGameType[])
    .find((game) => (next.stages[game] ?? 0) > (previous.stages[game] ?? 0));
  return gameType ? { id: `familiarity:${gameType}:${next.stages[gameType]}`, kind: 'familiarity',
    gameType, stage: next.stages[gameType]! } : null;
}

export const useProgressionNoticeStore = create<ProgressionNoticeStore>((set, get) => ({
  accountId: null,
  seen: null,
  queue: [],
  initialize: (accountId) => {
    if (accountId === get().accountId) return;
    ++requestVersion;
    set({ accountId, seen: null, queue: [] });
  },
  refresh: async () => {
    if (!get().accountId) return;
    const version = ++requestVersion;
    const result = await apiRequest<{ progression: ProgressionStatus }>('/api/auth/progression');
    if (version !== requestVersion || !result.success) return;
    set((state) => {
      const seen = baseline(result.progression, state.seen);
      // The first snapshot is silent; subsequent updates summarize only their highest-priority change.
      const notice = state.seen ? nextNotice(state.seen, seen) : null;
      return { seen, queue: notice ? [...state.queue, notice] : state.queue };
    });
  },
  dismiss: (id) => set((state) => ({ queue: state.queue.filter((entry) => entry.id !== id) })),
}));
