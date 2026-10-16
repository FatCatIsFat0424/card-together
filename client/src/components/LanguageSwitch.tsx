// ─── LanguageSwitch: locale switch ───

import type { ReactNode } from 'react';
import { useActiveIndicator } from '../hooks/use-active-indicator';
import { useI18nStore } from '../stores/i18n-store';
import { getAvailableLocales } from '../i18n';
import type { Locale } from '../i18n';
import styles from './LanguageSwitch.module.css';

const LOCALE_LABELS: Record<Locale, string> = {
  'zh-TW': '中文',
  en: 'EN',
};

export function LanguageSwitch(): ReactNode {
  const { locale, setLocale } = useI18nStore();
  const { containerRef, indicatorRef } = useActiveIndicator<HTMLDivElement, HTMLSpanElement>('[data-active]', locale);

  return (
    <div ref={containerRef} className={styles.languageSwitch}>
      <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" />
      {getAvailableLocales().map((loc) => (
        <button
          key={loc}
          className={`${styles.langBtn} touch-target ${locale === loc ? styles.langBtnActive : ''}`}
          data-active={locale === loc || undefined}
          onClick={() => setLocale(loc)}
        >
          {LOCALE_LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
