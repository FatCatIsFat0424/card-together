import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import styles from './SocialNotifications.module.css';

export function NotificationPanel(): ReactNode {
  const { t } = useI18nStore();
  const incoming = useSocialStore((state) => state.incoming);
  const accepted = useSocialStore((state) => state.accepted);
  const status = useSocialStore((state) => state.status);
  const error = useSocialStore((state) => state.error);
  return <section className={styles.panel} aria-labelledby="notifications-heading">
    <h2 id="notifications-heading">{t('social.notifications')}</h2>
    {status === 'loading' && <p role="status">{t('common.loading')}</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-outline"
      onClick={() => void useSocialStore.getState().refresh()}>{t('common.retry')}</button></div>}
    {incoming.length + accepted.length === 0 && status === 'ready'
      && <p className={styles.empty}>{t('social.noNotifications')}</p>}
    <ul className={styles.list}>
      {incoming.map((request) => <li key={request.id}>
        <Link to="/friends?tab=incoming">{t('social.incoming', { nickname: request.requester.nickname })}</Link>
      </li>)}
      {accepted.map((notice) => <li key={notice.id} className={styles.accepted}>
        <Link to={`/messages/${encodeURIComponent(notice.account.id)}`}>
          {t('social.accepted', { nickname: notice.account.nickname })}</Link>
        <button type="button" className={styles.dismiss}
          aria-label={t('social.dismiss')}
          onClick={() => void useSocialStore.getState().dismissAccepted([notice.id])}>×</button>
      </li>)}
    </ul>
  </section>;
}
