import type { ReactNode } from 'react';
import { DAILY_CHECK_IN_COINS, DAILY_TASKS } from '@shared/constants/daily-rewards';
import type { DailyRewardsStatus, DailyTaskId } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import styles from './DailyPanel.module.css';

/** Share of a daily task done, between 0 and 100. */
export function taskPercent(progress: number, target: number): number {
  return target > 0 ? Math.min(100, Math.max(0, Math.round((progress / target) * 100))) : 0;
}

/** Compact daily tasks and check-in for the lobby's social column; the dialogs hold the full views. */
export function DailyPanel({ status, error, pending, onClaim, onOpenTasks, onOpenCheckIn, onRetry }: {
  readonly status: DailyRewardsStatus | null;
  readonly error: boolean;
  readonly pending: boolean;
  readonly onClaim: (id: DailyTaskId) => void;
  readonly onOpenTasks: () => void;
  readonly onOpenCheckIn: () => void;
  readonly onRetry: () => void;
}): ReactNode {
  const { t } = useI18nStore();
  const checkedIn = Boolean(status?.checkInDays.includes(status.day));
  return <section className={styles.panel} aria-labelledby="daily-panel-title">
    <div className={styles.heading}>
      <h2 id="daily-panel-title">{t('daily.tasks')}</h2>
      <Button variant="text" size="small" aria-haspopup="dialog" onClick={onOpenTasks}>{t('daily.viewAll')}</Button>
    </div>
    {error ? <p className={styles.message} role="alert">{t('daily.error')}{' '}
      <Button size="small" onClick={onRetry}>{t('daily.retry')}</Button></p>
      : !status ? <p className={styles.message} role="status">{t('common.loading')}</p>
      : <ul className={styles.tasks}>{status.tasks.map(({ id, progress }) => {
        const task = DAILY_TASKS.find((entry) => entry.id === id);
        if (!task) return null;
        const claimed = status.claimedTasks.includes(id);
        const complete = progress >= task.target;
        return <li key={id} className={styles.task}>
          <div className={styles.taskText}>
            <span className={styles.taskName}>{t(`daily.${id}`)}</span>
            <span className={styles.taskCount}>{Math.min(progress, task.target)}/{task.target}</span>
          </div>
          <div className={styles.bar} role="progressbar" aria-label={t(`daily.${id}`)} aria-valuemin={0}
            aria-valuemax={task.target} aria-valuenow={Math.min(progress, task.target)}>
            <span style={{ width: `${taskPercent(progress, task.target)}%` }} />
          </div>
          {complete || claimed
            ? <Button variant={claimed ? 'ghost' : 'primary'} size="small" disabled={pending || claimed}
              icon={claimed ? 'check' : undefined} className={styles.claim}
              aria-label={t('daily.claimTask', { task: t(`daily.${id}`) })} onClick={() => onClaim(id)}>
              {t(claimed ? 'daily.claimed' : 'daily.claim')}</Button>
            : <span className={styles.reward} aria-label={t('daily.reward', { coins: String(task.coins) })}>
              <AppIcon name="coins" />{task.coins}</span>}
        </li>;
      })}</ul>}
    <Button variant={checkedIn ? 'ghost' : 'primary'} className={`${styles.checkIn} ${checkedIn ? '' : styles.unclaimed}`} aria-haspopup="dialog"
      icon={checkedIn ? 'check' : 'calendar'} onClick={onOpenCheckIn}>
      {t('daily.checkIn')}
      <span className={styles.checkInReward}>{checkedIn ? t('daily.signedIn') : t('daily.reward', { coins: String(DAILY_CHECK_IN_COINS) })}</span>
    </Button>
  </section>;
}
