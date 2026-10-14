import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { Avatar } from './Avatar';
import styles from './DirectMessages.module.css';

export function MessageConversations({ selectedId, split = false }: {
  readonly selectedId?: string;
  readonly split?: boolean;
}): ReactNode {
  const conversations = useSocialStore((state) => state.conversations);
  const status = useSocialStore((state) => state.status);
  const { locale, t } = useI18nStore();
  return <>
    {status === 'ready' && conversations.length === 0 && <p className={styles.empty}>{t('messages.empty')}</p>}
    <ul className={`${styles.conversations} ${split ? styles.splitList : ''}`}>{conversations.map((conversation) => <li key={conversation.account.id}>
      <Link to={`/messages/${encodeURIComponent(conversation.account.id)}`}
        aria-current={selectedId === conversation.account.id ? 'page' : undefined}>
        {split && <span className={styles.conversationAvatar}><Avatar avatar={conversation.account.avatar}
          image={conversation.account.avatarImage} border={conversation.account.avatarBorder}
          color={conversation.account.color} size="medium" /></span>}
        <strong>{conversation.account.nickname}</strong><span className={styles.username}>@{conversation.account.username}</span>
        <span className={styles.preview}>{conversation.lastMessage.sticker || conversation.lastMessage.providedSticker || conversation.lastMessage.shopSticker
          ? t('messages.sticker') : conversation.lastMessage.content}</span>
        <time dateTime={new Date(conversation.lastMessage.timestamp).toISOString()}>
          {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(conversation.lastMessage.timestamp)}</time>
        {conversation.unreadCount > 0 && <span className={styles.unread}>{t('social.unread', { n: String(conversation.unreadCount) })}</span>}
      </Link>
    </li>)}</ul>
  </>;
}
