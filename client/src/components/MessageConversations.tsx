import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation } from '@shared/types/direct-message';
import type { FriendEntry, PublicAccount } from '@shared/types/social';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { useMotionStore } from '../stores/motion-store';
import { Avatar } from './Avatar';
import styles from './DirectMessages.module.css';

/** Today's messages show only the time so the split list fits it beside the name. */
export function listTime(timestamp: number, locale: string, now = Date.now()): string {
  const sameDay = new Date(timestamp).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, sameDay ? { timeStyle: 'short' } : { month: 'numeric', day: 'numeric' })
    .format(timestamp);
}

export interface MessageListEntry {
  readonly account: PublicAccount;
  /** Null for a current friend without retained history. */
  readonly conversation: Conversation | null;
}

/**
 * Conversations (including read-only former friends) newest first, then current friends
 * without retained history by nickname.
 */
export function messageListEntries(conversations: readonly Conversation[],
  friends: readonly PublicAccount[], locale: string): MessageListEntry[] {
  const listed = new Set(conversations.map((conversation) => conversation.account.id));
  const collator = new Intl.Collator(locale);
  return [
    ...[...conversations].sort((first, second) => second.lastMessage.timestamp - first.lastMessage.timestamp)
      .map((conversation): MessageListEntry => ({ account: conversation.account, conversation })),
    ...friends.filter((friend) => !listed.has(friend.id))
      .sort((first, second) => collator.compare(first.nickname, second.nickname)
        || collator.compare(first.username, second.username))
      .map((account): MessageListEntry => ({ account, conversation: null })),
  ];
}

export function MessageConversations({ selectedId, split = false, friends }: {
  readonly selectedId?: string;
  readonly split?: boolean;
  /** Null until friends load; conversations still show meanwhile. */
  readonly friends: readonly FriendEntry[] | null;
}): ReactNode {
  const conversations = useSocialStore((state) => state.conversations);
  const status = useSocialStore((state) => state.status);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const { locale, t } = useI18nStore();
  const entries = messageListEntries(conversations, friends ?? [], locale);
  const presence = new Map(friends?.map((friend) => [friend.id, friend.online]));
  const fullTime = (timestamp: number): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
  return <>
    {status === 'ready' && friends && entries.length === 0 && <p className={styles.empty}>{t('messages.empty')}</p>}
    <ul className={`${styles.conversations} ${split ? styles.splitList : ''}`} data-reduced-motion={reducedMotion || undefined}>
      {entries.map(({ account, conversation }, index) => <li key={account.id}
        style={split ? { '--entry-index': Math.min(index, 12) } as CSSProperties : undefined}>
      <Link to={`/messages/${encodeURIComponent(account.id)}`}
        aria-current={selectedId === account.id ? 'page' : undefined}>
        {split && <span className={styles.conversationAvatar}><Avatar avatar={account.avatar}
          image={account.avatarImage} border={account.avatarBorder}
          color={account.color} size="medium" /></span>}
        <strong className={styles.conversationName}><span>{account.nickname}</span>
          {presence.has(account.id) && <span className={styles.presenceDot} role="img"
            data-online={presence.get(account.id)}
            aria-label={t(presence.get(account.id) ? 'friends.online' : 'friends.offline')}
            title={t(presence.get(account.id) ? 'friends.online' : 'friends.offline')} />}
        </strong><span className={styles.username}>@{account.username}</span>
        {!conversation && (
          // Keeps the row as tall as rows with a preview line.
          <span className={styles.preview} aria-hidden="true">{'\u00a0'}</span>
        )}
        {conversation && <>
          <span className={styles.preview}>{conversation.lastMessage.sticker || conversation.lastMessage.providedSticker
            || conversation.lastMessage.shopSticker ? t('messages.sticker') : conversation.lastMessage.content}</span>
          <time dateTime={new Date(conversation.lastMessage.timestamp).toISOString()}
            title={fullTime(conversation.lastMessage.timestamp)}>
            {split ? listTime(conversation.lastMessage.timestamp, locale) : fullTime(conversation.lastMessage.timestamp)}</time>
          {conversation.unreadCount > 0 && <span className={styles.unread}>{t('social.unread', { n: String(conversation.unreadCount) })}</span>}
        </>}
      </Link>
    </li>)}</ul>
  </>;
}
