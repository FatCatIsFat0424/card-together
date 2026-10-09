import type { ReactNode } from 'react';
import { reconnectSocket } from '../socket';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './ConnectionBanner.module.css';

/** Non-blocking notice shown while an established session reconnects. */
export function ConnectionBanner(): ReactNode {
  const connection = useAccountStore((state) => state.connection);
  const { t } = useI18nStore();
  if (connection === 'ready') return null;
  const failed = connection === 'error';
  return (
    <div className={styles.anchor}>
      <div className={`${styles.banner} ${failed ? styles.failed : ''}`} role="status" aria-live="polite">
        <span className={styles.dot} aria-hidden="true" />
        <span>{t(failed ? 'connection.interrupted' : 'connection.reconnecting')}</span>
        {failed && <button type="button" className={`btn btn-primary ${styles.retry}`} onClick={reconnectSocket}>
          {t('common.retry')}</button>}
      </div>
    </div>
  );
}
