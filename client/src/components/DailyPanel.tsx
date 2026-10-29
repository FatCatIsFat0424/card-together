import type { ReactNode } from 'react';
import { DAILY_CHECK_IN_COINS, DAILY_TASKS } from '@shared/constants/daily-rewards';
import type { DailyRewardsStatus, DailyTaskId } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import type { ButtonVariant } from './Button';
import styles from './DailyPanel.module.css';

/** Share of a daily task done, between 0 and 100. */
export function taskPercent(progress: number, target: number): number {
  return target > 0 ? Math.min(100, Math.max(0, Math.round((progress / target) * 100))) : 0;
}

/** The swap control for an unfinished task; disabled once the task has progress or today's swap is used. */
export function DailySwapButton({ id, label, replaceable, pending, replacing, onReplace, className, variant }: {
  readonly id: DailyTaskId; readonly label: string; readonly replaceable: boolean; readonly pending: boolean;
  readonly replacing: boolean; readonly onReplace: (id: DailyTaskId) => void; readonly className?: string;
  readonly variant?: ButtonVariant;
}): ReactNode {
  const { t } = useI18nStore();
  return <Button variant={variant} size="small" icon="refresh" className={className} disabled={pending || !replaceable} aria-busy={replacing || undefined}
    aria-label={t('daily.replaceTask', { task: label })} onClick={() => onReplace(id)}>
    {t(replacing ? 'daily.replacing' : 'daily.replace')}</Button>;
}

/** Compact daily tasks and check-in for the lobby's social column; the dialogs hold the full views. */
export function DailyPanel({ status, error, pending, replacing = null, onClaim, onReplace, onOpenTasks, onOpenCheckIn, onRetry }: {
  readonly status: DailyRewardsStatus | null;
  readonly error: boolean;
  readonly pending: boolean;
  /** The task whose swap request is in flight. */
  readonly replacing?: DailyTaskId | null;
  readonly onClaim: (id: DailyTaskId) => void;
  readonly onReplace: (id: DailyTaskId) => void;
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
      : <><ul className={styles.tasks}>{status.tasks.map(({ id, progress, favorite, replaceable }) => {
        const task = DAILY_TASKS.find((entry) => entry.id === id);
        if (!task) return null;
        const label = t(`daily.${id}`);
        const claimed = status.claimedTasks.includes(id);
        const complete = progress >= task.target;
        const swappable = !complete && !claimed && status.swapsRemaining > 0;
        return <li key={id} className={`${styles.task} ${swappable ? styles.withSwap : ''}`}>
          <div className={styles.taskText}>
            <span className={styles.taskName} title={label}>{label}</span>
            {favorite && <span className={styles.favorite}>{t('daily.favorite')}</span>}
            <span className={styles.taskCount}>{Math.min(progress, task.target)}/{task.target}</span>
          </div>
          <div className={styles.bar} role="progressbar" aria-label={label} aria-valuemin={0}
            aria-valuemax={task.target} aria-valuenow={Math.min(progress, task.target)}>
            <span style={{ width: `${taskPercent(progress, task.target)}%` }} />
          </div>
          {complete || claimed
            ? <Button variant={claimed ? 'ghost' : 'primary'} size="small" disabled={pending || claimed}
              icon={claimed ? 'check' : undefined} className={styles.claim}
              aria-label={t('daily.claimTask', { task: label })} onClick={() => onClaim(id)}>
              {t(claimed ? 'daily.claimed' : 'daily.claim')}</Button>
            : <span className={styles.reward} aria-label={t('daily.reward', { coins: String(task.coins) })}>
              <AppIcon name="coins" />{task.coins}</span>}
          {swappable && <DailySwapButton variant="text" id={id} label={label} replaceable={replaceable}
            pending={pending} replacing={replacing === id} onReplace={onReplace} className={styles.swap} />}
        </li>;
      })}</ul>
      <p className={styles.swapNote}>{t('daily.replacements', { count: String(status.swapsRemaining) })}</p></>}
    <Button variant={checkedIn ? 'ghost' : 'primary'} className={`${styles.checkIn} ${checkedIn ? '' : styles.unclaimed}`} aria-haspopup="dialog"
      icon={checkedIn ? 'check' : 'calendar'} onClick={onOpenCheckIn}>
      {t('daily.checkIn')}
      <span className={styles.checkInReward}>{checkedIn ? t('daily.signedIn') : t('daily.reward', { coins: String(DAILY_CHECK_IN_COINS) })}</span>
    </Button>
  </section>;
}
