import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { DirectConversation } from '../components/DirectConversation';
import { MessageConversations } from '../components/MessageConversations';
import { AppIcon } from '../components/AppIcon';
import styles from './MessagesPage.module.css';

export function MessagesPage(): ReactNode {
  const { accountId: otherId } = useParams<{ accountId: string }>();
  const accountId = useAccountStore((state) => state.account?.id);
  const mobile = useMediaQuery('(max-width: 52rem)');
  const { t } = useI18nStore();
  if (!accountId) return null;

  return <main className={styles.page}>
    <div className={styles.layout}>
      <aside className={`${styles.sidebar} ${otherId ? styles.hideOnMobile : ''}`} aria-label={t('messages.back')}>
        {(!mobile || !otherId) && <MessageConversations selectedId={otherId} split={!mobile} />}
      </aside>
      <div className={`${styles.detail} ${!otherId ? styles.hideOnMobile : ''}`}>
        {otherId
          ? <DirectConversation key={`${accountId}:${otherId}`} ownId={accountId} otherId={otherId} embedded={!mobile} />
          : <div className={styles.empty}><AppIcon name="chat" /><p>{t('messages.selectConversation')}</p></div>}
      </div>
    </div>
  </main>;
}
