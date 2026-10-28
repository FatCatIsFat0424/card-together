import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AcceptedFriendNotification, IncomingFriendNotification } from '@shared/types/direct-message';
import { apiRequest } from '../api';
import type { TranslationKey } from '../i18n';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import styles from './SocialNotifications.module.css';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** One row of the panel; requests stay until answered, accepted notices until cleared. */
export type NotificationEntry =
  | { readonly kind: 'incoming'; readonly id: string; readonly createdAt: number; readonly readAt: number | null;
    readonly request: IncomingFriendNotification }
  | { readonly kind: 'accepted'; readonly id: string; readonly createdAt: number; readonly readAt: number | null;
    readonly notice: AcceptedFriendNotification };

/** Newest first, split into today and earlier by the viewer's calendar day. */
export function notificationGroups(incoming: readonly IncomingFriendNotification[],
  accepted: readonly AcceptedFriendNotification[], now = Date.now()): { today: NotificationEntry[]; earlier: NotificationEntry[] } {
  const entries: NotificationEntry[] = [
    ...incoming.map((request): NotificationEntry => ({ kind: 'incoming', id: request.id, createdAt: request.createdAt,
      readAt: request.readAt, request })),
    ...accepted.map((notice): NotificationEntry => ({ kind: 'accepted', id: notice.id, createdAt: notice.createdAt,
      readAt: notice.readAt, notice })),
  ].sort((first, second) => second.createdAt - first.createdAt);
  const today = new Date(now).toDateString();
  return {
    today: entries.filter((entry) => new Date(entry.createdAt).toDateString() === today),
    earlier: entries.filter((entry) => new Date(entry.createdAt).toDateString() !== today),
  };
}

/** Within the hour as "N minutes ago", later today as a time, before today as a date. */
export function notificationTime(timestamp: number, locale: string, now = Date.now()): string {
  const elapsed = now - timestamp;
  if (elapsed >= 0 && elapsed < HOUR_MS) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-Math.max(1, Math.floor(elapsed / MINUTE_MS)), 'minute');
  }
  const sameDay = new Date(timestamp).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'long', day: 'numeric' })
    .format(timestamp);
}

/** The translated sentence with the nickname set in bold. */
function Sentence({ messageKey, nickname }: { readonly messageKey: TranslationKey; readonly nickname: string }): ReactNode {
  const { t } = useI18nStore();
  const marker = '\u0000';
  const [before, after = ''] = t(messageKey, { nickname: marker }).split(marker);
  return <>{before}<b>{nickname}</b>{after}</>;
}

function NotificationRow({ entry, busy, onAnswer }: {
  readonly entry: NotificationEntry; readonly busy: boolean;
  readonly onAnswer: (requestId: string, accept: boolean) => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const unread = entry.readAt === null;
  const account = entry.kind === 'incoming' ? entry.request.requester : entry.notice.account;
  const to = entry.kind === 'incoming' ? '/friends?tab=incoming' : `/messages/${encodeURIComponent(account.id)}`;
  const markRead = (): void => { if (unread) void useSocialStore.getState().markNotificationsRead([entry.id]); };
  return <li className={styles.item} data-unread={unread || undefined}>
    <span className={styles.kindIcon} data-kind={entry.kind} role="img" aria-label={t(`social.kind.${entry.kind}`)}>
      <AppIcon name={entry.kind === 'incoming' ? 'personAdd' : 'personCheck'} />
    </span>
    <div className={styles.itemBody}>
      <Link to={to} className={styles.itemLink} onClick={markRead}>
        <Sentence messageKey={entry.kind === 'incoming' ? 'social.incoming' : 'social.accepted'} nickname={account.nickname} />
        {unread && <span className={styles.srOnly}> ({t('social.unreadNotice')})</span>}
      </Link>
      <time dateTime={new Date(entry.createdAt).toISOString()}>{notificationTime(entry.createdAt, locale)}</time>
      {entry.kind === 'incoming' && <div className={styles.itemActions}>
        <Button size="small" variant="primary" disabled={busy} onClick={() => onAnswer(entry.id, true)}>
          {t('friends.accept')}</Button>
        <Button size="small" disabled={busy} onClick={() => onAnswer(entry.id, false)}>{t('friends.decline')}</Button>
      </div>}
    </div>
    <span className={styles.itemEnd}>
      {unread && <span className={styles.unreadDot} aria-hidden="true" />}
      {entry.kind === 'accepted' && <button type="button" className={styles.itemDismiss} aria-label={t('social.dismiss')}
        title={t('social.dismiss')} onClick={() => void useSocialStore.getState().clearNotifications([entry.id])}>
        <AppIcon name="close" /></button>}
    </span>
  </li>;
}

export function NotificationPanel(): ReactNode {
  const { t } = useI18nStore();
  const incoming = useSocialStore((state) => state.incoming);
  const accepted = useSocialStore((state) => state.accepted);
  const status = useSocialStore((state) => state.status);
  const error = useSocialStore((state) => state.error);
  const [busy, setBusy] = useState(false);
  const [answerError, setAnswerError] = useState('');
  const groups = notificationGroups(incoming, accepted);
  const unread = [...incoming, ...accepted].some((entry) => entry.readAt === null);
  const readAccepted = accepted.filter((notice) => notice.readAt !== null).length;
  const answer = (requestId: string, accept: boolean): void => {
    setBusy(true);
    setAnswerError('');
    void apiRequest(accept ? `/api/friends/requests/${encodeURIComponent(requestId)}/accept`
      : `/api/friends/requests/${encodeURIComponent(requestId)}`, accept ? 'POST' : 'DELETE').then(async (result) => {
      if (!result.success) setAnswerError(result.error);
      await useSocialStore.getState().refresh();
      setBusy(false);
    });
  };
  const list = (key: 'today' | 'earlier'): ReactNode => groups[key].length > 0 && <>
    <h3 className={styles.group}>{t(key === 'today' ? 'social.today' : 'social.earlier')}</h3>
    <ul className={styles.list}>
      {groups[key].map((entry) => <NotificationRow key={`${entry.kind}:${entry.id}`} entry={entry} busy={busy} onAnswer={answer} />)}
    </ul>
  </>;
  return <section className={styles.panel} aria-labelledby="notifications-heading">
    <div className={styles.head}>
      <h2 id="notifications-heading">{t('social.notifications')}</h2>
      <button type="button" className={styles.textButton} disabled={!unread}
        onClick={() => void useSocialStore.getState().markNotificationsRead('all')}>{t('social.markAllRead')}</button>
    </div>
    {status === 'loading' && <p className={styles.notice} role="status">{t('common.loading')}</p>}
    {(error || answerError) && <div className={styles.notice} role="alert"><p>{answerError || error}</p>
      <Button size="small" onClick={() => { setAnswerError(''); void useSocialStore.getState().refresh(); }}>
        {t('common.retry')}</Button></div>}
    {incoming.length + accepted.length === 0 && status === 'ready'
      && <p className={`${styles.notice} ${styles.empty}`}>{t('social.noNotifications')}</p>}
    {list('today')}
    {list('earlier')}
    <div className={styles.foot}>
      <button type="button" className={`${styles.textButton} ${styles.muted}`} disabled={readAccepted === 0}
        onClick={() => void useSocialStore.getState().clearNotifications('read')}>
        {t('social.clearRead', { n: String(readAccepted) })}</button>
      <Link className={`${styles.textButton} ${styles.muted}`} to="/friends?tab=incoming">
        {t('social.friendRequests')}<AppIcon name="nextPage" /></Link>
    </div>
  </section>;
}
