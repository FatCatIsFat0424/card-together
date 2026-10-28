import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DirectMessage, MessageHistory, MessageInput } from '@shared/types/direct-message';
import type { FriendEntry, PublicAccount } from '@shared/types/social';
import { apiRequest } from '../api';
import { createMessageClientId } from '../messages/message-client-id';
import { latestIncomingMessageId, mergeDirectMessages } from '../messages/message-history';
import { groupDirectMessages, groupTimeLabel, messageDay, startsNewDay } from '../messages/message-groups';
import type { MessageGroup } from '../messages/message-groups';
import { AppIcon } from './AppIcon';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ChatMessageBody, EmojiPicker } from './ChatEmoji';
import type { StickerPayload } from './ChatEmoji';
import { IconButton } from './IconButton';
import { Nameplate } from './Nameplate';
import { OverflowMenu } from './OverflowMenu';
import { PresenceAvatar } from './FriendCard';
import { friendActivityText } from './friend-activity-text';
import { friendAction } from './lobby-friend-activity';
import { useInviteFriend } from '../hooks/use-invite-friend';
import { useRoomStore } from '../stores/room-store';
import { ChatFrame } from '../cosmetics/chat-frames/ChatFrame';
import { PROVIDED_EMOJIS } from '../provided-emoji';
import { useAccountStore } from '../stores/account-store';
import { useEmojiStore } from '../stores/emoji-store';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import { useMotionStore } from '../stores/motion-store';
import chatStyles from './ChatPanel.module.css';
import styles from './DirectMessages.module.css';

/** A day separator: today, yesterday, or the date. */
function DaySeparator({ timestamp, locale }: { readonly timestamp: number; readonly locale: string }): ReactNode {
  const { t } = useI18nStore();
  const day = messageDay(timestamp, locale);
  return <div className={styles.day} role="separator">
    <span>{day.kind === 'date' ? day.label : t(day.kind === 'today' ? 'social.today' : 'messages.yesterday')}</span>
  </div>;
}

/** The friend's groups carry their avatar beside the bubbles; your own groups show only the time. */
const DirectMessageGroupRow = memo(function DirectMessageGroupRow({ group, locale, dateTimeFormat }: {
  readonly group: MessageGroup; readonly locale: string; readonly dateTimeFormat: Intl.DateTimeFormat;
}): ReactNode {
  const first = group.messages[0];
  return <div className={`${styles.group} ${group.own ? styles.ownGroup : ''}`}>
    {!group.own && <span className={styles.groupAvatar}><Avatar avatar={first.sender.avatar} image={first.sender.avatarImage}
      border={first.sender.avatarBorder} color={first.sender.color} size="row" /></span>}
    <div className={styles.stack}>
      <div className={styles.messageMeta}>{!group.own && <b>{first.sender.nickname}</b>}
        <time dateTime={new Date(first.timestamp).toISOString()} title={dateTimeFormat.format(first.timestamp)}>
          {groupTimeLabel(first.timestamp, locale)}</time>
      </div>
      {group.messages.map((message) => <ChatFrame key={message.id} as="article" id={message.sender.chatFrame}
        className={`${styles.message} ${group.own ? styles.ownMessage : ''}`}>
        <div className={styles.messageContent}><ChatMessageBody message={message} /></div>
      </ChatFrame>)}
    </div>
  </div>;
});

/** Name, nameplate and what the friend is doing, with room invite and more actions. */
function ConversationHeader({ account, friend, onClose }: {
  readonly account: PublicAccount; readonly friend: FriendEntry | undefined; readonly onClose?: () => void;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const navigate = useNavigate();
  const roomCode = useRoomStore((state) => state.currentRoomCode);
  const { invited, error, invite } = useInviteFriend();
  const activity = friend && friendActivityText(friend, locale);
  const profile = `/players/${encodeURIComponent(account.id)}`;
  const canInvite = friend !== undefined && friendAction(friend, roomCode) === 'invite';
  return <>
    <Link to={profile} className={styles.headerAvatar} tabIndex={-1} aria-hidden="true">
      {friend ? <PresenceAvatar friend={friend} size="compact" />
        : <Avatar avatar={account.avatar} image={account.avatarImage} border={account.avatarBorder} color={account.color} size="compact" />}
    </Link>
    <div className={styles.who} data-player-identity>
      <span className={styles.whoName}>
        <Link to={profile} aria-label={t('player.view', { nickname: account.nickname })}>{account.nickname}</Link>
        <span className={styles.whoTitle}><Nameplate id={account.nameplate} /></span>
        <span className={styles.whoInline}>@{account.username}</span>
      </span>
      <small>{activity && <><span className={styles.activityDot} data-online={friend?.online || undefined} aria-hidden="true" />
        {activity.short}<span className={styles.whoSeparator} aria-hidden="true"> · </span></>}
        <span className={styles.whoUsername}>@{account.username}</span></small>
    </div>
    {error && <span className={styles.headerError} role="alert">{error}</span>}
    {canInvite && <Button className={styles.headerInvite} disabled={invited.has(account.id)} onClick={() => invite(account.id)}>
      {t(invited.has(account.id) ? 'invite.sent' : 'messages.inviteToRoom')}</Button>}
    <span className={styles.headerMore}>
      <OverflowMenu label={t('friends.moreFor', { nickname: account.nickname })}
        items={[{ label: t('friends.viewProfile'), onSelect: () => navigate(profile) }]} />
    </span>
    {onClose && <IconButton icon="close" label={t('messages.close')} className={styles.headerClose} onClick={onClose} />}
  </>;
}

export function DirectConversation({
  ownId, otherId, initialAccount, friend, embedded = false, onLoadError, refreshVersion = 0, onClose,
}: {
  readonly ownId: string; readonly otherId: string;
  readonly initialAccount?: PublicAccount;
  /** Live presence of a current friend, for the header's activity line and room invite. */
  readonly friend?: FriendEntry;
  readonly embedded?: boolean;
  /** Short landscape: the header closes the messages window, since the page has no title bar there. */
  readonly onClose?: () => void;
  readonly onLoadError: (otherId: string, error: string) => void;
  readonly refreshVersion?: number;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const dateTimeFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    dateStyle: 'short', timeStyle: 'short',
  }), [locale]);
  const revision = useSocialStore((state) => state.revision);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const emojis = useEmojiStore((state) => state.emojis);
  const [history, setHistory] = useState<MessageHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const pagingRef = useRef(false);
  const refreshAfterPage = useRef(false);
  const pending = useRef<{ clientId: string; payload: MessageInput } | null>(null);
  const readCursor = useRef<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollBefore = useRef<{ height: number; top: number } | null>(null);
  const latestMessage = history?.messages.at(-1)?.id;
  const latestIncoming = latestIncomingMessageId(history?.messages ?? [], ownId, otherId);
  const displayedAccount = history?.account ?? (initialAccount?.id === otherId ? initialAccount : undefined);
  const groups = useMemo(() => groupDirectMessages(history?.messages ?? [], ownId), [history?.messages, ownId]);
  const current = (): boolean => mounted.current && useAccountStore.getState().account?.id === ownId;

  useEffect(() => { onLoadError(otherId, error); }, [error, onLoadError, otherId]);

  useEffect(() => {
    mounted.current = true;
    void useEmojiStore.getState().load();
    return () => { mounted.current = false; sequence.current += 1; };
  }, []);

  const load = useCallback(async (before?: string): Promise<void> => {
    const request = ++sequence.current;
    setError('');
    if (before) {
      setPaging(true);
      pagingRef.current = true;
      const container = messagesRef.current;
      scrollBefore.current = container ? { height: container.scrollHeight, top: container.scrollTop } : null;
    }
    const result = await apiRequest<MessageHistory>(`/api/messages/${encodeURIComponent(otherId)}${before
      ? `?before=${encodeURIComponent(before)}` : ''}`);
    if (!mounted.current || request !== sequence.current || useAccountStore.getState().account?.id !== ownId) return;
    setLoading(false);
    setPaging(false);
    pagingRef.current = false;
    if (!result.success) { scrollBefore.current = null; setError(result.error); return; }
    setHistory((previous) => {
      const previousIds = new Set(previous?.messages.map((message) => message.id));
      // Reload the bounded window after a long disconnection to avoid hiding a history gap.
      const replaceWindow = !before && result.hasMore
        && !result.messages.some((message) => previousIds.has(message.id));
      return {
        account: result.account, canSend: result.canSend,
        messages: mergeDirectMessages(replaceWindow ? [] : previous?.messages ?? [], result.messages, before ? 'before' : 'after'),
        hasMore: before || !previous || replaceWindow ? result.hasMore : previous.hasMore && result.messages.length > 0,
      };
    });
  }, [otherId, ownId]);

  useEffect(() => {
    if (pagingRef.current) refreshAfterPage.current = true;
    else void load();
  }, [load, revision, refreshVersion]);

  useEffect(() => {
    if (!paging && refreshAfterPage.current) { refreshAfterPage.current = false; void load(); }
  }, [load, paging]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    if (scrollBefore.current) {
      container.scrollTop = scrollBefore.current.top + container.scrollHeight - scrollBefore.current.height;
      scrollBefore.current = null;
    } else container.scrollTo({ top: container.scrollHeight });
  }, [latestMessage, history?.messages.length]);

  const markVisible = useCallback(async (): Promise<void> => {
    if (document.visibilityState !== 'visible' || !latestIncoming || readCursor.current === latestIncoming) return;
    readCursor.current = latestIncoming;
    const success = await useSocialStore.getState().markRead(otherId, latestIncoming);
    if (!mounted.current || useAccountStore.getState().account?.id !== ownId) return;
    if (readCursor.current !== latestIncoming) return;
    if (!success) readCursor.current = null;
    setReadError(!success);
  }, [latestIncoming, otherId, ownId]);

  useEffect(() => {
    void markVisible();
    const visible = (): void => { void markVisible(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [markVisible]);

  useEffect(() => {
    if (!pickerOpen) return;
    const outside = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-direct-picker]')) setPickerOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setPickerOpen(false); inputRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [pickerOpen]);

  const send = async (payload: MessageInput, retry = false): Promise<void> => {
    if (busyRef.current || !history?.canSend) return;
    const matchesPending = pending.current && JSON.stringify(pending.current.payload) === JSON.stringify(payload);
    const submission = retry || matchesPending ? pending.current : { clientId: createMessageClientId(), payload };
    if (!submission) return;
    pending.current = submission;
    busyRef.current = true;
    setBusy(true);
    setSendFailed(false);
    const result = await apiRequest<{ message: DirectMessage }>(`/api/messages/${encodeURIComponent(otherId)}`,
      'POST', { clientId: submission.clientId, ...submission.payload });
    busyRef.current = false;
    if (!current()) return;
    setBusy(false);
    if (!result.success) {
      setSendFailed(true);
      if (result.status === 403) void load();
      return;
    }
    pending.current = null;
    setHistory((previous) => previous && { ...previous, messages: mergeDirectMessages(previous.messages, [result.message]) });
    if ('message' in submission.payload) setInput('');
    setPickerOpen(false);
    void useSocialStore.getState().refresh();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const message = input.trim();
    if (message) void send({ message });
  };

  const insertEmoji = (name: string): void => {
    const field = inputRef.current;
    const start = field?.selectionStart ?? input.length;
    const end = field?.selectionEnd ?? input.length;
    const token = `:${name}:`;
    const next = input.slice(0, start) + token + input.slice(end);
    if (next.length > 500) return;
    setInput(next);
    setPickerOpen(false);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return <>
    <section className={`${styles.conversation} ${embedded ? styles.embedded : ''}`} aria-label={t('messages.title')}
      data-reduced-motion={reducedMotion || undefined}>
    <header className={styles.header}>
      {!embedded && <Link className={styles.backLink} to="/messages"><AppIcon name="previousPage" /> {t('messages.back')}</Link>}
      {displayedAccount && <ConversationHeader account={displayedAccount}
        friend={friend?.id === displayedAccount.id ? friend : undefined} onClose={onClose} />}
      {!displayedAccount && onClose && <IconButton icon="close" label={t('messages.close')} className={styles.headerClose}
        onClick={onClose} />}
    </header>
    <div className={chatStyles.messageArea}>
      <div ref={messagesRef} className={`${styles.messages} ${history ? styles.messagesReady : ''}`} role="log" aria-live="polite" aria-relevant="additions" aria-busy={loading || paging}>
        {loading && <p className={styles.loadingNotice} role="status">{t('common.loading')}</p>}
        {history?.hasMore && <Button type="button" disabled={paging}
          onClick={() => void load(history.messages[0]?.id)}>
          {paging ? t('common.loading') : t('messages.older')}</Button>}
        {history?.messages.length === 0 && <p className={styles.empty}>{t('messages.emptyConversation')}</p>}
        {groups.map((group, index) => <Fragment key={group.key}>
          {startsNewDay(group, groups[index - 1]) && <DaySeparator timestamp={group.messages[0].timestamp} locale={locale} />}
          <DirectMessageGroupRow group={group} locale={locale} dateTimeFormat={dateTimeFormat} />
        </Fragment>)}
      </div>
      {pickerOpen && (loading || history?.canSend) && <div data-direct-picker>
        <EmojiPicker personal={emojis} provided={PROVIDED_EMOJIS} busy={busy} onInsert={insertEmoji}
          onSendSticker={(payload: StickerPayload) => void send(payload)} />
      </div>}
    </div>
    {readError && <p className={styles.notice} role="alert">{t('common.error')}{' '}
      <Button type="button" onClick={() => void markVisible()}>{t('common.retry')}</Button></p>}
    {sendFailed && <p className={styles.notice} role="alert">{t('messages.sendFailed')}{' '}
      <Button type="button" disabled={busy || !history?.canSend}
        onClick={() => { if (pending.current) void send(pending.current.payload, true); }}>{t('messages.retrySend')}</Button></p>}
    {history && !history.canSend && <p className={styles.notice}>{t('messages.formerFriend')}</p>}
    {(loading || history?.canSend) && <div className={styles.composer}>
      <form className={chatStyles.chatInputRow} onSubmit={submit}>
        <button type="button" className={chatStyles.pickerBtn} data-direct-picker disabled={busy || loading}
          aria-label={t('emoji.picker')} aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
          <AppIcon name="emoji" /></button>
        <input ref={inputRef} type="text" className={chatStyles.chatInput} maxLength={500} value={input} disabled={busy || loading}
          aria-label={t('chat.placeholder')} onChange={(event) => setInput(event.target.value)}
          placeholder={embedded && !onClose && displayedAccount
            ? t('messages.placeholderFor', { nickname: displayedAccount.nickname }) : t('chat.placeholder')} />
        <button type="submit" className={chatStyles.chatSendBtn} disabled={busy || loading || !input.trim()}>{t('chat.send')}</button>
      </form>
    </div>}
    </section>
  </>;
}
