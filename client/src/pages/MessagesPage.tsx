import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useAccountStore } from '../stores/account-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { useSocialStore } from '../stores/social-store';
import { DirectConversation } from '../components/DirectConversation';
import { MessageConversations } from '../components/MessageConversations';
import { AppIcon } from '../components/AppIcon';
import styles from './MessagesPage.module.css';

export function MessagesPage(): ReactNode {
  const { accountId: otherId } = useParams<{ accountId: string }>();
  const accountId = useAccountStore((state) => state.account?.id);
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const inGame = useRoomStore((state) => state.roomInfo?.status === 'playing');
  const status = useSocialStore((state) => state.status);
  const error = useSocialStore((state) => state.error);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [conversationError, setConversationError] = useState<{ otherId: string; message: string } | null>(null);
  const handleLoadError = useCallback((otherId: string, message: string): void => {
    setConversationError((previous) => previous?.otherId === otherId && previous.message === message
      ? previous : { otherId, message });
  }, []);
  const loadError = conversationError && conversationError.otherId === otherId ? conversationError.message : '';
  const mobile = useMediaQuery('(max-width: 52rem)');
  const { t } = useI18nStore();
  if (!accountId) return null;

  const refresh = async (): Promise<void> => {
    const revision = useSocialStore.getState().revision;
    setRefreshing(true);
    try {
      await useSocialStore.getState().refresh();
    } finally {
      // Failed overview requests do not advance the conversation's revision.
      if (useSocialStore.getState().revision === revision) setRefreshVersion((version) => version + 1);
      setRefreshing(false);
    }
  };

  return <main className={styles.page}>
    <div className={styles.layout}>
      <header className={styles.toolbar}>
        <div className={styles.toolbarContent}>
          <h1>{t('messages.title')}</h1>
          <button type="button" className={`${styles.refreshButton} touch-target`} disabled={refreshing || status === 'loading'}
            aria-label={t('common.refresh')} title={t('common.refresh')}
            onClick={() => void refresh()}>
            <AppIcon name="refresh" />
          </button>
          <p className={styles.retention}>{t('messages.retention')}</p>
          {status === 'loading' && <p className={styles.status} role="status">{t('common.loading')}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {loadError && loadError !== error && <p className={styles.error} role="alert">{loadError}</p>}
        </div>
        <Link className={styles.closeButton} to={roomCode ? `/${inGame ? 'game' : 'room'}/${roomCode}` : '/'}
          aria-label={t('table.close')} title={t('table.close')}>
          <AppIcon name="close" />
        </Link>
      </header>
      <div className={styles.panels}>
        <aside className={`${styles.sidebar} ${otherId ? styles.hideOnMobile : ''}`} aria-label={t('messages.back')}>
          {(!mobile || !otherId) && <MessageConversations selectedId={otherId} split={!mobile} />}
        </aside>
        <div className={`${styles.detail} ${!otherId ? styles.hideOnMobile : ''}`}>
          {otherId
            ? <DirectConversation key={`${accountId}:${otherId}`} ownId={accountId} otherId={otherId}
              embedded={!mobile} onLoadError={handleLoadError} refreshVersion={refreshVersion} />
            : <div className={styles.empty}><AppIcon name="chat" /><p>{t('messages.selectConversation')}</p></div>}
        </div>
      </div>
    </div>
  </main>;
}
