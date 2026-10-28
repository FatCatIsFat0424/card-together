import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Conversation } from '@shared/types/direct-message';
import type { FriendEntry, PublicAccount } from '@shared/types/social';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { useMotionStore } from '../stores/motion-store';
import { useAccountStore } from '../stores/account-store';
import { AppIcon } from './AppIcon';
import { Avatar } from './Avatar';
import { PresenceAvatar } from './FriendCard';
import styles from './DirectMessages.module.css';

/** Today's messages show only the time so the split list fits it beside the name; yesterday's say so. */
export function listTime(timestamp: number, locale: string, now = Date.now(), yesterdayLabel?: string): string {
  const sameDay = new Date(timestamp).toDateString() === new Date(now).toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (yesterdayLabel && new Date(timestamp).toDateString() === yesterday.toDateString()) return yesterdayLabel;
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

/** Case-insensitive match on nickname, username, or the last message text. */
export function matchesConversation(entry: MessageListEntry, query: string): boolean {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return [entry.account.nickname, entry.account.username, entry.conversation?.lastMessage.content ?? '']
    .some((text) => text.toLowerCase().includes(search));
}

export function MessageConversations({ selectedId, split = false, friends, searchable = false }: {
  readonly selectedId?: string;
  readonly split?: boolean;
  /** Null until friends load; conversations still show meanwhile. */
  readonly friends: readonly FriendEntry[] | null;
  /** Desktop: a search field filters the list by friend or message. */
  readonly searchable?: boolean;
}): ReactNode {
  const conversations = useSocialStore((state) => state.conversations);
  const status = useSocialStore((state) => state.status);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const ownId = useAccountStore((state) => state.account?.id);
  const { locale, t } = useI18nStore();
  const [query, setQuery] = useState('');
  const all = messageListEntries(conversations, friends ?? [], locale);
  const entries = all.filter((entry) => matchesConversation(entry, query));
  const presence = new Map(friends?.map((friend) => [friend.id, friend]));
  const fullTime = (timestamp: number): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
  const preview = (conversation: Conversation): string => {
    const message = conversation.lastMessage;
    const text = message.sticker || message.providedSticker || message.shopSticker ? t('messages.sticker') : message.content;
    return message.sender.id === ownId ? t('messages.you', { text }) : text;
  };
  return <>
    {searchable && <label className={styles.search}>
      <AppIcon name="search" />
      <input type="search" value={query} aria-label={t('messages.search')} placeholder={t('messages.search')}
        onChange={(event) => setQuery(event.target.value)} />
    </label>}
    {status === 'ready' && friends && all.length === 0 && <p className={styles.empty}>{t('messages.empty')}</p>}
    {all.length > 0 && entries.length === 0 && <p className={styles.empty}>{t('messages.noMatch')}</p>}
    <ul className={`${styles.conversations} ${split ? styles.splitList : ''}`} data-reduced-motion={reducedMotion || undefined}>
      {entries.map(({ account, conversation }, index) => {
        const friend = presence.get(account.id);
        const unread = conversation?.unreadCount ?? 0;
        return <li key={account.id}
          style={split ? { '--entry-index': Math.min(index, 12) } as CSSProperties : undefined}>
          <Link to={`/messages/${encodeURIComponent(account.id)}`} data-unread={unread > 0 || undefined}
            aria-current={selectedId === account.id ? 'page' : undefined}>
            {split && <span className={styles.conversationAvatar}>{friend ? <PresenceAvatar friend={friend} size="compact" />
              : <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder}
                color={account.color} size="compact" />}</span>}
            <strong className={styles.conversationName}><span>{account.nickname}</span>
              {!split && friend && <span className={styles.presenceDot} role="img"
                data-online={friend.online}
                aria-label={t(friend.online ? 'friends.online' : 'friends.offline')}
                title={t(friend.online ? 'friends.online' : 'friends.offline')} />}
            </strong><span className={styles.username}>@{account.username}</span>
            {!conversation && (
              // Keeps the row as tall as rows with a preview line.
              <span className={styles.preview} aria-hidden="true">{' '}</span>
            )}
            {conversation && <>
              <span className={styles.preview}>{preview(conversation)}</span>
              <time dateTime={new Date(conversation.lastMessage.timestamp).toISOString()}
                title={fullTime(conversation.lastMessage.timestamp)}>
                {split ? listTime(conversation.lastMessage.timestamp, locale, undefined, t('messages.yesterday'))
                  : fullTime(conversation.lastMessage.timestamp)}</time>
              {unread > 0 && (split
                ? <span className={styles.unreadCount} aria-label={t('social.unread', { n: String(unread) })}>
                  {unread > 99 ? '99+' : unread}</span>
                : <span className={styles.unread}>{t('social.unread', { n: String(unread) })}</span>)}
            </>}
          </Link>
        </li>;
      })}
    </ul>
  </>;
}
