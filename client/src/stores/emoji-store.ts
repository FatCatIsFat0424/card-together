import { create } from 'zustand';
import type { EmojiRecord } from '@shared/types';
import { apiRequest } from '../api';

interface EmojiStore {
  emojis: EmojiRecord[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Fetches the signed-in account's library once; later calls are no-ops until reset. */
  load: () => Promise<void>;
  setEmojis: (emojis: EmojiRecord[]) => void;
  reset: () => void;
}

let libraryGeneration = 0;

export const useEmojiStore = create<EmojiStore>((set, get) => ({
  emojis: [],
  status: 'idle',
  load: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    const generation = libraryGeneration;
    set({ status: 'loading' });
    const result = await apiRequest<{ emojis: EmojiRecord[] }>('/api/emojis');
    if (generation !== libraryGeneration || get().status !== 'loading') return;
    set(result.success ? { emojis: result.emojis, status: 'ready' } : { status: 'error' });
  },
  setEmojis: (emojis) => {
    libraryGeneration += 1;
    set({ emojis, status: 'ready' });
  },
  reset: () => {
    libraryGeneration += 1;
    set({ emojis: [], status: 'idle' });
  },
}));
