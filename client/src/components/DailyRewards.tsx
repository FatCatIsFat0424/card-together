import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Snackbar from '@mui/material/Snackbar';
import { DAILY_TASKS, DAILY_CHECK_IN_COINS } from '@shared/constants/daily-rewards';
import type { AccountProfile, DailyRewardId, DailyRewardsStatus, DailyTaskId } from '@shared/types';
import { apiRequest } from '../api';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import { DailyPanel, DailySwapButton } from './DailyPanel';
import { IconButton } from './IconButton';
import { dialogParts, dialogPaperClass } from '../styles/dialog';
import styles from './DailyRewards.module.css';

export function CheckInCalendar({ status, pending, onCheckIn, celebrate = false, reward }: {
  readonly status: DailyRewardsStatus; readonly pending: boolean; readonly onCheckIn: () => void;
  /** Shown beside the month so the dialog keeps its height. */
  readonly reward?: ReactNode;
  /** Plays the claim animation on today's date; set only right after this session's claim. */
  readonly celebrate?: boolean;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const [year, month] = status.day.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(start);
  const weekdays = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return <section className={styles.calendar} aria-label={monthLabel}>
    <div className={styles.calendarHead}><h3>{monthLabel}</h3>{reward}</div>
    <div className={styles.calendarGrid}>
      {Array.from({ length: 7 }, (_, day) => <span className={styles.weekday} key={`weekday-${day}`}>
        {weekdays.format(new Date(Date.UTC(2026, 0, 4 + day)))}</span>)}
      {Array.from({ length: start.getUTCDay() }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
      {Array.from({ length: days }, (_, index) => {
        const date = `${status.day.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`;
        const today = date === status.day;
        const checked = status.checkInDays.includes(date);
        const stamped = celebrate && today && checked;
        return <button type="button" key={date} className={`${styles.day} ${today ? styles.today : ''} ${checked ? styles.checked : ''} ${stamped ? styles.stamped : ''}`}
          disabled={!today || checked || pending} onClick={onCheckIn} aria-current={today ? 'date' : undefined}
          aria-label={`${t('daily.checkInDate', { date })}${checked ? ` · ${t('daily.signedIn')}` : ''}`}>
          <span>{index + 1}</span>
          {checked ? <AppIcon name="check" /> : today ? <small>{t('daily.today')}</small> : <span aria-hidden="true">·</span>}
          {stamped && <span className={styles.coinBurst} aria-hidden="true"><AppIcon name="coins" />+{DAILY_CHECK_IN_COINS}</span>}
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

export function DailyTaskList({ status, pending, replacing, onClaim, onReplace }: {
  readonly status: DailyRewardsStatus; readonly pending: boolean;
  /** The task whose swap request is in flight. */
  readonly replacing?: DailyTaskId | null;
  readonly onClaim: (id: DailyTaskId) => void; readonly onReplace: (id: DailyTaskId) => void;
}): ReactNode {
  const { t } = useI18nStore();
  return <>
    <ul className={styles.tasks}>{status.tasks.map(({ id, progress, favorite, replaceable }) => {
      const task = DAILY_TASKS.find((entry) => entry.id === id)!;
      const label = t(`daily.${id}`);
      const claimed = status.claimedTasks.includes(id);
      const complete = progress >= task.target;
      return <li key={id} className={`${styles.task} ${claimed ? styles.claimedTask : ''}`}>
        <div className={styles.reward} aria-label={t('daily.reward', { coins: String(task.coins) })}>
          <AppIcon name="coins" /><strong>{task.coins}</strong>
        </div>
        <div className={styles.taskBody}>
          <div className={styles.taskTitle}><h3>{label}{favorite && <span className={styles.favorite}>{t('daily.favorite')}</span>}</h3>
            <span className={styles.count}>{progress}/{task.target}</span></div>
          <progress className={styles.bar} value={progress} max={task.target} aria-label={label} />
        </div>
        <div className={styles.taskActions}>
          {complete || claimed ? <Button variant="primary" size="small" disabled={pending || claimed}
            icon={claimed ? 'check' : undefined}
            aria-label={t('daily.claimTask', { task: label })} onClick={() => onClaim(id)}>
            {t(claimed ? 'daily.claimed' : 'daily.claim')}</Button>
            : <DailySwapButton id={id} label={label} replaceable={replaceable} pending={pending}
              replacing={replacing === id} onReplace={onReplace} />}
        </div>
      </li>;
    })}</ul>
    <div className={styles.taskFooter}>
      <span>{t('daily.reset')}</span>
      <span>{t('daily.replacements', { count: String(status.swapsRemaining) })}</span>
    </div>
  </>;
}

/** Lets the opened calendar render unchecked before today's automatic claim marks it. */
const AUTO_CHECK_IN_DELAY_MS = 700;

/** Whether the lobby should claim today's check-in itself; one attempt per server day. */
export function needsAutoCheckIn(status: DailyRewardsStatus, attemptedDay: string): boolean {
  return status.day !== attemptedDay && !status.checkInDays.includes(status.day);
}

/** `icons` shows two icon buttons that open the dialogs; `panel` shows the compact task bars and check-in button. */
export function DailyRewards({ layout = 'icons' }: { readonly layout?: 'icons' | 'panel' }): ReactNode {
  const { t } = useI18nStore();
  const accountId = useAccountStore((state) => state.account?.id);
  const coinRevision = useAccountStore((state) => state.account?.coinRevision);
  const accountUpdatedAt = useAccountStore((state) => state.account?.updatedAt);
  const [dialog, setDialog] = useState<'tasks' | 'check-in'>('tasks');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState<DailyRewardsStatus | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [replacing, setReplacing] = useState<DailyTaskId | null>(null);
  const [notice, setNotice] = useState('');
  const [celebrateDay, setCelebrateDay] = useState('');
  const claiming = useRef(false);
  const requestVersion = useRef(0);
  const autoCheckInDay = useRef('');
  const autoCheckInTimer = useRef(0);

  useEffect(() => {
    let active = true;
    const version = ++requestVersion.current;
    void apiRequest<{ dailyRewards: DailyRewardsStatus }>('/api/auth/daily-rewards').then((result) => {
      if (!active || version !== requestVersion.current) return;
      setError(!result.success);
      if (result.success) setStatus(result.dailyRewards);
    });
    return () => { active = false; };
  }, [accountId, coinRevision, accountUpdatedAt, dialog, dialogOpen, refresh]);

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

  const mutate = async (reward: DailyRewardId, replacing = false): Promise<boolean> => {
    if (!status || claiming.current || !accountId) return false;
    claiming.current = true;
    setPending(true);
    if (replacing) setReplacing(reward as DailyTaskId);
    ++requestVersion.current;
    const result = await apiRequest<{ account: AccountProfile; dailyRewards: DailyRewardsStatus }>(
      replacing ? '/api/auth/daily-rewards/replace' : '/api/auth/daily-rewards', 'POST',
      replacing ? { task: reward, day: status.day } : { reward, day: status.day },
    );
    if (useAccountStore.getState().account?.id !== accountId) return false;
    ++requestVersion.current;
    claiming.current = false;
    setPending(false);
    setReplacing(null);
    if (result.success) {
      setStatus(result.dailyRewards);
      setError(false);
      useAccountStore.getState().setAccount(result.account);
      if (reward === 'check-in') setCelebrateDay(result.dailyRewards.day);
      const coins = DAILY_TASKS.find((task) => task.id === reward)?.coins ?? DAILY_CHECK_IN_COINS;
      setNotice(replacing ? t('daily.replaced') : t('daily.success', { coins: String(coins) }));
    } else {
      setNotice(t(replacing ? 'daily.replaceError' : 'daily.claimError'));
      setRefresh((value) => value + 1);
    }
    return result.success;
  };
  const autoCheckIn = useEffectEvent((loaded: DailyRewardsStatus): void => {
    if (claiming.current || !needsAutoCheckIn(loaded, autoCheckInDay.current)) return;
    autoCheckInDay.current = loaded.day;
    setDialog('check-in');
    setDialogOpen(true);
    autoCheckInTimer.current = window.setTimeout(() => { void mutate('check-in'); }, AUTO_CHECK_IN_DELAY_MS);
  });
  useEffect(() => { if (status) autoCheckIn(status); }, [status]);
  useEffect(() => () => window.clearTimeout(autoCheckInTimer.current), []);
  const checkedIn = status?.checkInDays.includes(status.day);
  const open = (kind: 'tasks' | 'check-in'): void => {
    setDialog(kind);
    setDialogOpen(true);
  };
  // Keep the selected content and width through MUI's exit transition.
  const close = (): void => { if (!pending) { setDialogOpen(false); setCelebrateDay(''); } };
  const claimable = status?.tasks.some(({ id, progress }) =>
    progress >= DAILY_TASKS.find((task) => task.id === id)!.target && !status.claimedTasks.includes(id));
  return <aside className={styles.widgets}>
    {layout === 'panel' ? <DailyPanel status={status} error={error} pending={pending} replacing={replacing}
      onClaim={(id) => { void mutate(id); }} onReplace={(id) => { void mutate(id, true); }} onOpenTasks={() => open('tasks')} onOpenCheckIn={() => open('check-in')}
      onRetry={() => setRefresh((value) => value + 1)} /> : <>
      <IconButton icon="info" label={t('daily.tasks')} aria-haspopup="dialog" badge={claimable ? 'dot' : undefined}
        onClick={() => open('tasks')} />
      <IconButton icon="calendar" label={t('daily.checkIn')} aria-haspopup="dialog" badge={status && !checkedIn ? 'dot' : undefined}
        onClick={() => open('check-in')} />
    </>}
    <Dialog open={dialogOpen} onClose={close} aria-labelledby="daily-rewards-title"
      slotProps={{ paper: { className: dialogPaperClass(dialog === 'tasks' ? 'narrow' : 'medium', dialog === 'tasks' && styles.tasksDialog) } }}>
      <DialogTitle component="div" className={`${dialogParts.header} ${styles.dialogHeader}`}>
        <div className={styles.dialogHeading}><h2 id="daily-rewards-title"><AppIcon name={dialog === 'tasks' ? 'info' : 'calendar'} />{t(dialog === 'tasks' ? 'daily.tasks' : 'daily.checkIn')}</h2>
          {dialog === 'tasks' && status && <div className={styles.taskMeta}>
            <DailyTaskCountdown key={status.serverTime} status={status} /></div>}</div>
        <IconButton icon="close" label={t('table.close')} onClick={close} disabled={pending} />
      </DialogTitle>
      <DialogContent className={`${dialogParts.body} ${styles.content}`} inert={!dialogOpen}>
        {error ? <p role="alert">{t('daily.error')} <Button size="small" onClick={() => setRefresh((value) => value + 1)}>{t('daily.retry')}</Button></p>
          : !status ? <p role="status">{t('common.loading')}</p>
          : dialog === 'tasks' ? <DailyTaskList status={status} pending={pending} replacing={replacing}
            onClaim={(id) => { void mutate(id); }} onReplace={(id) => { void mutate(id, true); }} /> : <>
            <CheckInCalendar status={status} pending={pending} celebrate={celebrateDay === status.day}
              onCheckIn={() => { void mutate('check-in'); }}
              reward={<p className={styles.checkInReward}><AppIcon name="coins" />{t('daily.reward', { coins: String(DAILY_CHECK_IN_COINS) })}</p>} />
          </>}
      </DialogContent>
    </Dialog>
    <Snackbar open={Boolean(notice)} message={notice} autoHideDuration={4000} onClose={() => setNotice('')} />
  </aside>;
}
