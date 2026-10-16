import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

const STORAGE_KEY = 'sound.effects';

interface SoundEffectsState {
  /** Card plays, passes, eliminations, the start impact, and table effects; turn and join chimes are separate. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useSoundEffectsStore = create<SoundEffectsState>((set) => ({
  enabled: readPreference(STORAGE_KEY) !== 'false',
  setEnabled: (enabled) => {
    set({ enabled });
    writePreference(STORAGE_KEY, String(enabled));
  },
}));
