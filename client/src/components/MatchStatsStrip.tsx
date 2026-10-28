import type { ReactNode } from 'react';
import type { MatchStatistics, RecentOutcome, StatsScope } from '../match-statistics';
import { useI18nStore } from '../stores/i18n-store';
import { Button } from './Button';
import { StatsScopeToggle } from './StatsScopeToggle';
import styles from './MatchStatsStrip.module.css';

const DOT_CLASS: Readonly<Record<RecentOutcome, string>> = { win: styles.win, loss: styles.loss, tie: styles.tie };

/** Colored dots of the latest results, oldest first; each one names its game, date and result. */
export function RecentDots({ statistics }: { readonly statistics: MatchStatistics }): ReactNode {
  const { t, locale } = useI18nStore();
  return <span className={styles.dots} role="img"
    aria-label={`${t('history.summary.recent')}: ${statistics.recent.map((item) => t(`history.outcome.${item.outcome}`)).join(', ')}`}>
    {statistics.recent.map((item, index) => <i key={`${item.finishedAt}-${index}`} className={DOT_CLASS[item.outcome]}
      title={`${t(`gameType.${item.gameType}`)} · ${new Date(item.finishedAt).toLocaleDateString(locale)} · ${t(`history.outcome.${item.outcome}`)}`} />)}
  </span>;
}

/**
 * The profile header's statistics. The whole strip opens the detailed view; on desktop it also carries the
 * scope switch, which stays outside the opening button. Without any human-only match it says so and offers the
 * bot matches instead of showing zeroes.
 */
export function MatchStatsStrip({ statistics, wide, scope, onScopeChange, onOpen }: {
  readonly statistics: MatchStatistics;
  /** Desktop layout with every figure; otherwise one compact pill. */
  readonly wide: boolean;
  readonly scope: StatsScope;
  readonly onScopeChange: (scope: StatsScope) => void;
  readonly onOpen: () => void;
}): ReactNode {
  const { t, locale } = useI18nStore();
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  if (statistics.allMatches === 0) return null;
  if (statistics.matches === 0) return <div className={styles.empty}>
    <span>{t('history.scopeEmpty', { n: number.format(statistics.allMatches) })}</span>
    <Button size="small" onClick={() => onScopeChange('all')}>{t('history.scopeShowAll')}</Button>
  </div>;
  const winRate = statistics.winRate === null ? '—' : percent.format(statistics.winRate);
  if (!wide) return <button type="button" className={styles.pill} aria-haspopup="dialog" onClick={onOpen}>
    <span>{t('history.summary.matchCount', { n: number.format(statistics.matches) })}</span>
    <span>{t('history.summary.winRate')} <b>{winRate}</b></span>
    <span>{t('history.summary.bestStreak')} <b>{number.format(statistics.bestStreak)}</b></span>
    <span className={styles.go}>{t('history.statsShort')} ›</span>
  </button>;
  return <div className={styles.strip}>
    <StatsScopeToggle scope={scope} onChange={onScopeChange} className={styles.scope} />
    <button type="button" className={styles.open} aria-haspopup="dialog" onClick={onOpen}>
      <span className={styles.stat}>
        <small>{t('history.summary.matches')}</small>
        <b>{number.format(statistics.matches)}
          {scope === 'all' && <em>{t('history.summary.humans', { n: number.format(statistics.humanMatches) })}</em>}</b>
      </span>
      <span className={styles.stat}>
        <small>{t('history.summary.winRate')}</small>
        <b>{winRate}</b>
      </span>
      <span className={styles.stat}>
        <small>{t('history.summary.recent')}</small>
        <RecentDots statistics={statistics} />
      </span>
      <span className={styles.stat}>
        <small>{t('history.summary.bestStreak')}</small>
        <b>{number.format(statistics.bestStreak)}
          {statistics.currentStreak > 0 && <em>{t('history.summary.streakNow', { n: number.format(statistics.currentStreak) })}</em>}</b>
      </span>
      {statistics.topGame && <span className={styles.stat}>
        <small>{t('history.summary.topGame')}</small>
        <b>{t(`gameType.${statistics.topGame}`)}
          <em>{t('history.summary.matchCount', { n: number.format(statistics.topGameMatches) })}</em></b>
      </span>}
      <span className={styles.go}>{t('history.statistics')} ›</span>
    </button>
  </div>;
}
