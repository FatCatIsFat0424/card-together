import { create } from 'zustand';
import { clampVolume, parseVolume } from '../audio/mix';
import { readPreference, writePreference } from '../utils/preference-storage';

const STORAGE_KEY = 'sound.effects';
const VOLUME_KEY = 'sound.effects.volume';

interface SoundEffectsState {
  /** Card plays, passes, eliminations, the start impact, and table effects; turn and join chimes have their own switch. */
  enabled: boolean;
  /** 0-1 volume of the whole effects channel: game effects, turn reminders, and interface cues. */
  volume: number;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
}

export const useSoundEffectsStore = create<SoundEffectsState>((set) => ({
  enabled: readPreference(STORAGE_KEY) !== 'false',
  volume: parseVolume(readPreference(VOLUME_KEY), 1),
  setEnabled: (enabled) => {
    set({ enabled });
    writePreference(STORAGE_KEY, String(enabled));
  },
  setVolume: (value) => {
    if (!Number.isFinite(value)) return;
    const volume = clampVolume(value);
    set({ volume });
    writePreference(VOLUME_KEY, String(volume));
  },
}));
