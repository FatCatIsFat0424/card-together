import { useId } from 'react';
import type { ReactNode } from 'react';
import type { StatsScope } from '../match-statistics';
import { useI18nStore } from '../stores/i18n-store';
import styles from './StatsScopeToggle.module.css';

const SCOPES: readonly StatsScope[] = ['all', 'human'];

/** Two-way switch between all matches and human-only matches. */
export function StatsScopeToggle({ scope, onChange, className }: {
  readonly scope: StatsScope;
  readonly onChange: (scope: StatsScope) => void;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const labelId = useId();
  return <div className={`${styles.toggle} ${className ?? ''}`}>
    <span className={styles.label} id={labelId}>{t('history.scope')}</span>
    <div className={styles.options} role="group" aria-labelledby={labelId}>
      {SCOPES.map((value) => <button key={value} type="button" aria-pressed={scope === value}
        className={scope === value ? styles.on : undefined} onClick={() => onChange(value)}>
        {t(`history.scope.${value}`)}</button>)}
    </div>
  </div>;
}
