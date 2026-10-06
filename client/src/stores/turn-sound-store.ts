import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

const STORAGE_KEY = 'sound.turn';
interface TurnSoundState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

function savedEnabled(): boolean {
  return readPreference(STORAGE_KEY) !== 'false';
}

export const useTurnSoundStore = create<TurnSoundState>((set) => ({
  enabled: savedEnabled(),
  setEnabled: (enabled) => {
    set({ enabled });
    writePreference(STORAGE_KEY, String(enabled));
  },
}));
