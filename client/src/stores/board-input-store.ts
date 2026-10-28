import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

interface BoardInputStore {
  /** 「一點即走」: touch moves go out on the first choice instead of waiting for 確認. */
  oneTap: boolean;
  setOneTap: (oneTap: boolean) => void;
}

const STORAGE_KEY = 'board.oneTap';

export const useBoardInputStore = create<BoardInputStore>((set) => ({
  oneTap: readPreference(STORAGE_KEY) === 'true',
  setOneTap: (oneTap: boolean): void => {
    writePreference(STORAGE_KEY, String(oneTap));
    set({ oneTap });
  },
}));
