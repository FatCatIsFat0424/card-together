import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Snackbar from '@mui/material/Snackbar';
import { DAILY_TASKS, DAILY_CHECK_IN_COINS, DAILY_TASK_COUNT } from '@shared/constants/daily-rewards';
import type { AccountProfile, DailyRewardId, DailyRewardsStatus, DailyTaskId } from '@shared/types';
import { apiRequest } from '../api';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import styles from './DailyRewards.module.css';

export function CheckInCalendar({ status, pending, onCheckIn }: {
  readonly status: DailyRewardsStatus; readonly pending: boolean; readonly onCheckIn: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const [year, month] = status.day.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(start);
  const weekdays = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return <section className={styles.calendar} aria-label={monthLabel}>
    <h3>{monthLabel}</h3>
    <div className={styles.calendarGrid}>
      {Array.from({ length: 7 }, (_, day) => <span className={styles.weekday} key={`weekday-${day}`}>
        {weekdays.format(new Date(Date.UTC(2026, 0, 4 + day)))}</span>)}
      {Array.from({ length: start.getUTCDay() }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${status.day.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`;
        const today = date === status.day;
        const checked = status.checkInDays.includes(date);
        return <button type="button" key={date} className={`${styles.day} ${today ? styles.today : ''} ${checked ? styles.checked : ''}`}
          disabled={!today || checked || pending} onClick={onCheckIn} aria-current={today ? 'date' : undefined}
          aria-label={`${t('daily.checkInDate', { date })}${checked ? ` · ${t('daily.signedIn')}` : ''}`}>
          <span>{index + 1}</span>
          {checked ? <AppIcon name="check" /> : today ? <small>{t('daily.today')}</small> : <span aria-hidden="true">·</span>}
        </button>;
      })}
    </div>
  </section>;
}

function DailyTaskCountdown({ status }: { readonly status: DailyRewardsStatus }): ReactNode {
  const { t } = useI18nStore();
  const [remaining, setRemaining] = useState(status.resetsAt - status.serverTime);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setRemaining(Math.max(0,
      status.resetsAt - status.serverTime - (performance.now() - started))), 1000);
    return () => window.clearInterval(timer);
  }, [status.resetsAt, status.serverTime]);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((part) => String(part).padStart(2, '0')).join(':');
  return <span className={styles.countdown}><AppIcon name="timer" />{t('daily.refreshIn', { time })}</span>;
}

export function DailyTaskList({ status, pending, onClaim, onReplace }: {
  readonly status: DailyRewardsStatus; readonly pending: boolean;
  readonly onClaim: (id: DailyTaskId) => void; readonly onReplace: (id: DailyTaskId) => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <>
    <ul className={styles.tasks}>{status.tasks.map(({ id, progress }) => {
      const task = DAILY_TASKS.find((entry) => entry.id === id)!;
      const claimed = status.claimedTasks.includes(id);
      const complete = progress >= task.target;
      return <li key={id} className={`${styles.task} ${claimed ? styles.claimedTask : ''}`}>
        <div className={styles.reward} aria-label={t('daily.reward', { coins: String(task.coins) })}>
          <AppIcon name="coins" /><strong>{task.coins}</strong>
        </div>
        <div className={styles.taskBody}>
          <h3>{t(`daily.${id}`)}</h3>
          <div className={styles.progress}><progress value={progress} max={task.target} aria-label={t(`daily.${id}`)} /><span>{progress}/{task.target}</span></div>
        </div>
        <div className={styles.taskActions}>
          {(complete || claimed) && <button type="button" className="btn btn-primary" disabled={pending || claimed}
            aria-label={t('daily.claimTask', { task: t(`daily.${id}`) })} onClick={() => onClaim(id)}>
            {claimed && <AppIcon name="check" />}{t(claimed ? 'daily.claimed' : 'daily.claim')}</button>}
          {!claimed && <button type="button" className={complete ? styles.replaceLink : styles.replaceButton}
            disabled={pending || status.swapsRemaining === 0} aria-label={t('daily.replaceTask', { task: t(`daily.${id}`) })}
            onClick={() => onReplace(id)}><AppIcon name="refresh" />{t('daily.replace')}</button>}
        </div>
      </li>;
    })}</ul>
    <div className={styles.taskFooter}><span>{t('daily.replacements', { count: String(status.swapsRemaining) })}</span></div>
    <p className={styles.hint}>{t('daily.reset')}</p>
  </>;
}

export function DailyRewards(): ReactNode {
  const { t } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const coinRevision = useAccountStore((state) => state.account?.coinRevision);
  const accountUpdatedAt = useAccountStore((state) => state.account?.updatedAt);
  const [dialog, setDialog] = useState<'tasks' | 'check-in' | null>(null);
  const [status, setStatus] = useState<DailyRewardsStatus | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const claiming = useRef(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const version = ++requestVersion.current;
    void apiRequest<{ dailyRewards: DailyRewardsStatus }>('/api/auth/daily-rewards').then((result) => {
      if (!active || version !== requestVersion.current) return;
      setError(!result.success);
      if (result.success) setStatus(result.dailyRewards);
    });
    return () => { active = false; };
  }, [accountId, coinRevision, accountUpdatedAt, dialog, refresh]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setRefresh((value) => value + 1), status.resetsAt - status.serverTime + 100);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const refreshOnFocus = (): void => { setRefresh((value) => value + 1); };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, []);

  const mutate = async (reward: DailyRewardId, replacing = false): Promise<void> => {
    if (!status || claiming.current || !accountId) return;
    claiming.current = true;
    setPending(true);
    ++requestVersion.current;
    const result = await apiRequest<{ account: AccountProfile; dailyRewards: DailyRewardsStatus }>(
      replacing ? '/api/auth/daily-rewards/replace' : '/api/auth/daily-rewards', 'POST',
      replacing ? { task: reward, day: status.day } : { reward, day: status.day },
    );
    if (useAccountStore.getState().account?.id !== accountId) return;
    ++requestVersion.current;
    claiming.current = false;
    setPending(false);
    if (result.success) {
      setStatus(result.dailyRewards);
      setError(false);
      useAccountStore.getState().setAccount(result.account);
      const coins = DAILY_TASKS.find((task) => task.id === reward)?.coins ?? DAILY_CHECK_IN_COINS;
      setNotice(replacing ? t('daily.replaced') : t('daily.success', { coins: String(coins) }));
    } else {
      setNotice(t(replacing ? 'daily.replaceError' : 'daily.claimError'));
      setRefresh((value) => value + 1);
    }
  };
  const checkedIn = status?.checkInDays.includes(status.day);
  const close = (): void => { if (!pending) setDialog(null); };
  return <aside className={styles.widgets}>
    <button type="button" className={styles.widget} onClick={() => setDialog('tasks')} aria-haspopup="dialog">
      <AppIcon name="info" /><span><strong>{t('daily.tasks')}</strong>
        <small>{status ? t('daily.progress', { count: String(status.claimedTasks.length), target: String(DAILY_TASK_COUNT) }) : '—'}</small></span>
    </button>
    <button type="button" className={styles.widget} onClick={() => setDialog('check-in')} aria-haspopup="dialog">
      <AppIcon name="calendar" /><span><strong>{t('daily.checkIn')}</strong>
        <small>{t(checkedIn ? 'daily.signedIn' : 'daily.reward', { coins: String(DAILY_CHECK_IN_COINS) })}</small></span>
    </button>
    <Dialog open={dialog !== null} onClose={close} fullWidth maxWidth={dialog === 'tasks' ? 'md' : 'sm'} aria-labelledby="daily-rewards-title"
      slotProps={{ paper: { className: styles.dialog } }}>
      <DialogTitle component="div" className={styles.dialogHeader}>
        <div className={styles.dialogHeading}><h2 id="daily-rewards-title"><AppIcon name={dialog === 'tasks' ? 'info' : 'calendar'} />{t(dialog === 'tasks' ? 'daily.tasks' : 'daily.checkIn')}</h2>
          {dialog === 'tasks' && <div className={styles.taskMeta}><span>{t('daily.poolHint')}</span>
            {status && <DailyTaskCountdown key={status.serverTime} status={status} />}</div>}</div>
        <button type="button" className="btn btn-secondary" onClick={close} disabled={pending} aria-label={t('table.close')}><AppIcon name="close" /></button>
      </DialogTitle>
      <DialogContent dividers className={styles.content}>
        {error ? <p role="alert">{t('daily.error')} <button type="button" className="btn btn-secondary" onClick={() => setRefresh((value) => value + 1)}>{t('daily.retry')}</button></p>
          : !status ? <p role="status">{t('common.loading')}</p>
          : dialog === 'tasks' ? <DailyTaskList status={status} pending={pending}
            onClaim={(id) => { void mutate(id); }} onReplace={(id) => { void mutate(id, true); }} /> : <>
            <p className={styles.checkInReward}><AppIcon name="coins" />{t('daily.reward', { coins: String(DAILY_CHECK_IN_COINS) })}</p>
            <CheckInCalendar status={status} pending={pending} onCheckIn={() => { void mutate('check-in'); }} />
          </>}
      </DialogContent>
    </Dialog>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4000} onClose={() => setNotice('')} />
  </aside>;
}
