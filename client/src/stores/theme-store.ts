// ─── Theme Store: UI theme ───

import { create } from 'zustand';
import { readPreference, writePreference } from '../utils/preference-storage';

export type Theme = 'dashboard' | 'felt' | 'paper';
export const THEMES: readonly Theme[] = ['dashboard', 'felt', 'paper'];
/** Keep alternate themes available for a future appearance feature. */
export const THEME_SWITCH_ENABLED = false;

const STORAGE_KEY = 'theme';

export function parseTheme(value: string | null | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? 'dashboard';
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}

function readStoredTheme(): Theme {
  return THEME_SWITCH_ENABLED ? parseTheme(readPreference(STORAGE_KEY)) : 'dashboard';
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
