// ─── Theme Store：介面主題 ───

import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

export type Theme = 'dashboard' | 'felt' | 'paper';
export const THEMES: readonly Theme[] = ['dashboard', 'felt', 'paper'];

const STORAGE_KEY = 'theme';

export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? 'dashboard';
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): Theme {
  return parseTheme(readPreference(STORAGE_KEY));
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    writePreference(STORAGE_KEY, theme);
  },
}));
