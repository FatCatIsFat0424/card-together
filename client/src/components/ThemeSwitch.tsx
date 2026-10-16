// ─── ThemeSwitch: theme switch ───

import type { ReactNode } from 'react';
import { useActiveIndicator } from '../hooks/use-active-indicator';
import { useI18nStore } from '../stores/i18n-store';
import { THEMES, useThemeStore } from '../stores/theme-store';
import styles from './ThemeSwitch.module.css';

export function ThemeSwitch(): ReactNode {
  const { t } = useI18nStore();
  const { theme, setTheme } = useThemeStore();
  const { containerRef, indicatorRef } = useActiveIndicator<HTMLDivElement, HTMLSpanElement>('[aria-pressed="true"]', theme);

  return (
    <div ref={containerRef} className={styles.themeSwitch} role="group" aria-label={t('theme.label')}>
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          className={`${styles.themeBtn} touch-target ${theme === option ? styles.themeBtnActive : ''}`}
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
        >
          {t(`theme.${option}`)}
        </button>
      ))}
    </div>
  );
}
