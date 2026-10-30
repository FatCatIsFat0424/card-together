import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../client/src/utils/preference-storage', () => ({
  readPreference: () => 'felt', writePreference: vi.fn(),
}));

import { THEMES, THEME_SWITCH_ENABLED, parseTheme, useThemeStore } from '../../../client/src/stores/theme-store';
import { ThemeSwitch } from '../../../client/src/components/ThemeSwitch';

describe('parseTheme', () => {
  it('accepts every known theme', () => {
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
  });
  it('falls back to dashboard for missing or unknown values', () => {
    expect(parseTheme(null)).toBe('dashboard');
    expect(parseTheme(undefined)).toBe('dashboard');
    expect(parseTheme('neon')).toBe('dashboard');
  });

  it('starts in modern style even when a classic preference was saved', () => {
    expect(useThemeStore.getState().theme).toBe('dashboard');
    expect(THEME_SWITCH_ENABLED).toBe(false);
  });

  it('hides theme controls while retaining alternate theme definitions', () => {
    expect(renderToStaticMarkup(createElement(ThemeSwitch))).toBe('');
    expect(THEMES).toEqual(['dashboard', 'felt', 'paper']);
  });
});
