import type { ReactNode } from 'react';
import type { FriendEntry } from '@shared/types/social';
import { t } from '../i18n';
import type { Locale } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import styles from './FriendStatus.module.css';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatFriendLastSeen(lastSeenAt: number | null, locale: Locale, now = Date.now()): string {
  if (lastSeenAt === null || !Number.isSafeInteger(lastSeenAt) || lastSeenAt < 0) {
    return t('friends.lastSeenUnknown', locale);
  }
  const elapsed = Math.max(0, now - lastSeenAt);
  let time: string;
  if (elapsed > 30 * DAY_MS) time = t('friends.lastSeenOver30Days', locale);
  else if (elapsed < MINUTE_MS) time = t('friends.lastSeenJustNow', locale);
  else {
    const [unit, duration] = elapsed < HOUR_MS ? ['minute', MINUTE_MS] as const
      : elapsed < DAY_MS ? ['hour', HOUR_MS] as const : ['day', DAY_MS] as const;
    time = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
      .format(-Math.floor(elapsed / duration), unit);
  }
  return t('friends.lastSeen', locale, { time });
}

export function FriendStatus({ friend }: { friend: Pick<FriendEntry, 'online' | 'lastSeenAt'> }): ReactNode {
  const { locale, t: translate } = useI18nStore();
  return <span className={styles.status}>
    {friend.online && <span className={styles.onlineDot} aria-hidden="true" />}
    {friend.online ? translate('friends.online') : formatFriendLastSeen(friend.lastSeenAt, locale)}
  </span>;
}
