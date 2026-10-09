import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Seat } from '@shared/types';
import { clockTickDelay, countingMs, projectedServerNow, seatClock } from '../games/turn-clock';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './TurnClock.module.css';

interface TurnClockProps {
  seat: Seat;
  /** Players see only their own reserve; other seats show the turn allowance alone. */
  showBank?: boolean;
}

/** Chinese Poker's shared arrangement deadline, shown only on seats that still owe an arrangement. */
function ArrangeClock({ deadline }: { deadline: number }): ReactNode {
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const { t } = useI18nStore();
  const [, refresh] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      const remaining = deadline - (clock ? projectedServerNow(clock, receivedAt, Date.now()) : Date.now());
      if (remaining <= 0) return;
      timer = setTimeout(() => {
        refresh((value) => value + 1);
        schedule();
      }, clockTickDelay(remaining));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [deadline, clock, receivedAt]);
  const now = Date.now();
  const ms = Math.max(0, deadline - (clock ? projectedServerNow(clock, receivedAt, now) : now));
  const seconds = String(Math.ceil(ms / 1000));
  const description = [t('clock.base', { seconds }), ...(ms === 0 ? [t('clock.expired')] : [])].join(', ');
  return <div className={`${styles.clock} ${styles.active} ${ms <= 10_000 ? styles.bank : ''}`}
    role="timer" aria-live="off" aria-label={description} title={description}>
    <span aria-hidden="true">{t('clock.seconds', { seconds })}</span>
  </div>;
}

/** Seat clock chip: "turn + reserve" seconds for the own seat, the turn allowance elsewhere. */
export function TurnClock({ seat, showBank = true }: TurnClockProps): ReactNode {
  const arrangeDeadline = useGameStore((state) => state.chinesePoker?.phase === 'arranging'
    && !state.chinesePoker.submitted[seat] ? state.chinesePoker.arrangeDeadline : null);
  const simultaneous = useGameStore((state) => Boolean(state.chinesePoker));
  if (simultaneous) return showBank && arrangeDeadline !== null ? <ArrangeClock deadline={arrangeDeadline} /> : null;
  return <SeatTurnClock seat={seat} showBank={showBank} />;
}

function SeatTurnClock({ seat, showBank = true }: TurnClockProps): ReactNode {
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const { t } = useI18nStore();
  const [, refresh] = useState(0);
  const active = clock?.turn?.seat === seat;
  const now = Date.now();
  useEffect(() => {
    if (!active || !clock) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = (): void => {
      const time = seatClock(clock, seat, receivedAt, Date.now());
      // While paused for an animation, poll briefly so the countdown starts on time.
      const delay = time.paused ? 250 : clockTickDelay(countingMs(time));
      timer = setTimeout(() => {
        refresh((value) => value + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [active, clock, seat, receivedAt]);
  if (!clock || (!showBank && !active)) return null;
  const time = seatClock(clock, seat, receivedAt, now);
  const seconds = (ms: number): string => String(Math.ceil(ms / 1000));
  const base = seconds(time.active ? time.baseMs : clock.settings.baseSeconds * 1000);
  const bank = seconds(time.bankMs);
  const description = [t('clock.base', { seconds: base }),
    ...(showBank ? [t('clock.bank', { seconds: bank })] : []),
    ...(time.paused ? [t('clock.paused')] : []),
    ...(time.expired ? [t('clock.expired')] : [])].join(', ');
  return <div className={`${styles.clock} ${time.active ? styles.active : ''} ${time.active && time.baseMs === 0 ? styles.bank : ''}`}
    role="timer" aria-live="off" aria-label={description} title={description}>
    <span aria-hidden="true">{showBank ? `${base} + ${bank}` : t('clock.seconds', { seconds: base })}</span>
  </div>;
}
