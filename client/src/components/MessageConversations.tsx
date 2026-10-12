import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { useRoomStore } from '../stores/room-store';
import { AppIcon } from './AppIcon';
import { Avatar } from './Avatar';
import styles from './DirectMessages.module.css';

export function MessageHeading({ onRefresh, disabled = false }: {
  readonly onRefresh: () => void;
  readonly disabled?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const inGame = useRoomStore((state) => state.roomInfo?.status === 'playing');
  return <>
    <div className={styles.messageHeading}>
      <h1 className={styles.headingTitle}>{t('messages.title')}</h1>
      <button type="button" className={`${styles.refreshButton} touch-target`} disabled={disabled}
        aria-label={t('common.refresh')} title={t('common.refresh')} onClick={onRefresh}>
        <AppIcon name="refresh" />
      </button>
      {roomCode && <Link className={`btn btn-outline ${styles.roomLink}`} to={`/${inGame ? 'game' : 'room'}/${roomCode}`}>
        {t(inGame ? 'messages.returnGame' : 'messages.returnRoom')}</Link>}
    </div>
    <p className={styles.retention}>{t('messages.retention')}</p>
  </>;
}

export function MessageConversations({ selectedId, split = false }: {
  readonly selectedId?: string;
  readonly split?: boolean;
}): ReactNode {
  const conversations = useSocialStore((state) => state.conversations);
  const status = useSocialStore((state) => state.status);
  const error = useSocialStore((state) => state.error);
  const { locale, t } = useI18nStore();
  return <>
    <MessageHeading onRefresh={() => void useSocialStore.getState().refresh()} disabled={status === 'loading'} />
    {status === 'loading' && <p role="status">{t('common.loading')}</p>}
    {error && <p className={styles.notice} role="alert">{error}</p>}
    {status === 'ready' && conversations.length === 0 && <p className={styles.empty}>{t('messages.empty')}</p>}
    <ul className={`${styles.conversations} ${split ? styles.splitList : ''}`}>{conversations.map((conversation) => <li key={conversation.account.id}>
      <Link to={`/messages/${encodeURIComponent(conversation.account.id)}`}
        aria-current={selectedId === conversation.account.id ? 'page' : undefined}>
        {split && <span className={styles.conversationAvatar}><Avatar avatar={conversation.account.avatar}
          image={conversation.account.avatarImage} border={conversation.account.avatarBorder}
          color={conversation.account.color} size="medium" /></span>}
        <strong>{conversation.account.nickname}</strong><span className={styles.username}>@{conversation.account.username}</span>
        <span className={styles.preview}>{conversation.lastMessage.sticker || conversation.lastMessage.providedSticker
          ? t('messages.sticker') : conversation.lastMessage.content}</span>
        <time dateTime={new Date(conversation.lastMessage.timestamp).toISOString()}>
          {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(conversation.lastMessage.timestamp)}</time>
        {conversation.unreadCount > 0 && <span className={styles.unread}>{t('social.unread', { n: String(conversation.unreadCount) })}</span>}
      </Link>
    </li>)}</ul>
  </>;
}
