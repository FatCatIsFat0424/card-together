import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

interface MotionStore {
  reducedMotion: boolean;
  setReducedMotion: (reducedMotion: boolean) => void;
}

const STORAGE_KEY = 'ui.reducedMotion';

function initialReducedMotion(): boolean {
  const saved = readPreference(STORAGE_KEY);
  if (saved === 'true' || saved === 'false') return saved === 'true';
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const useMotionStore = create<MotionStore>((set) => ({
  reducedMotion: initialReducedMotion(),
  setReducedMotion: (reducedMotion: boolean): void => {
    writePreference(STORAGE_KEY, String(reducedMotion));
    set({ reducedMotion });
  },
}));
