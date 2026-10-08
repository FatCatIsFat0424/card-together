import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Seat } from '@shared/types';
import { seatClock } from '../games/turn-clock';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './TurnClock.module.css';

export function TurnClock({ seat, compact = false, showBank = true }: { seat: Seat; compact?: boolean; showBank?: boolean }): ReactNode {
  const clock = useGameStore((state) => state.visible?.clock);
  const receivedAt = useGameStore((state) => state.presentationReceivedAt);
  const { t } = useI18nStore();
  const [, refresh] = useState(0);
  const active = clock?.turn?.seat === seat;
  const now = Date.now();
  const serverNow = clock?.serverNow === undefined ? now : clock.serverNow + Math.max(0, now - receivedAt);
  const recentlyTimedOut = clock?.lastTimeout?.seat === seat && serverNow < clock.lastTimeout.at + 6000;
  useEffect(() => {
    if (!active && !recentlyTimedOut) return;
    const timer = setInterval(() => refresh((value) => value + 1), 200);
    return () => clearInterval(timer);
  }, [active, recentlyTimedOut]);
  if (!clock || (!showBank && !active && !recentlyTimedOut)) return null;
  const time = seatClock(clock, seat, receivedAt, now);
  const seconds = (ms: number): string => String(Math.ceil(ms / 1000));
  if (compact) {
    const base = seconds(time.active ? time.baseMs : clock.settings.baseSeconds * 1000);
    const bank = seconds(time.bankMs);
    const description = [t('clock.base', { seconds: base }), t('clock.bank', { seconds: bank }),
      ...(time.paused ? [t('clock.paused')] : []),
      ...(time.expired ? [t('clock.expired')] : []),
      ...(recentlyTimedOut ? [t('clock.autoPlayed')] : [])].join(', ');
    return <div className={`${styles.clock} ${styles.compact} ${time.active ? styles.active : ''} ${time.active && time.baseMs === 0 ? styles.bank : ''}`}
      role="timer" aria-live="off" aria-label={description} title={description}>
      <span aria-hidden="true">{base} + {bank}</span>
    </div>;
  }
  return <div className={`${styles.clock} ${time.active ? styles.active : ''} ${time.active && time.baseMs === 0 ? styles.bank : ''}`}
    role="timer" aria-live="off" aria-label={t('clock.seatLabel', { seat: t(`seat.${seat}`) })}>
    {time.active && <span>{t('clock.base', { seconds: seconds(time.baseMs) })}</span>}
    {showBank && <span>{t('clock.bank', { seconds: seconds(time.bankMs) })}</span>}
    {time.paused && <span className={styles.note}>{t('clock.paused')}</span>}
    {time.expired && <span className={styles.note}>{t('clock.expired')}</span>}
    {recentlyTimedOut && <span className={styles.note} role="status">{t('clock.autoPlayed')}</span>}
  </div>;
}
