import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import type { SocialNotice } from '../stores/social-store';
import styles from './SocialNotifications.module.css';

function Notice({ notice }: { readonly notice: SocialNotice }): ReactNode {
  const { t } = useI18nStore();
  useEffect(() => {
    const timeout = window.setTimeout(() => useSocialStore.getState().dismissNotice(notice.id), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice.id]);
  return <div className={styles.toast}>
    <Link to={notice.kind === 'incoming' ? '/friends?tab=incoming'
      : `/friends/messages/${encodeURIComponent(notice.accountId)}`}
      onClick={() => useSocialStore.getState().dismissNotice(notice.id)}>
      {t(`social.${notice.kind}`, { nickname: notice.nickname })}
    </Link>
    <button type="button" className={styles.dismiss} aria-label={t('social.dismiss')}
      onClick={() => useSocialStore.getState().dismissNotice(notice.id)}>×</button>
  </div>;
}

export function SocialToast(): ReactNode {
  const notices = useSocialStore((state) => state.notices);
  return <div className={styles.toasts} role="status" aria-live="polite">
    {notices.map((notice) => <Notice key={notice.id} notice={notice} />)}
  </div>;
}
