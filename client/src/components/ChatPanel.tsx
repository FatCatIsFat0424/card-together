import { memo, useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ChatMessage, RoomInfo } from '@shared/types';
import { socket } from '../socket';
import { PROVIDED_EMOJIS } from '../provided-emoji';
import { useChatStore } from '../stores/chat-store';
import { useChatMentionStore } from '../stores/chat-mention-store';
import { useChatMentionJump } from '../hooks/use-chat-mention-jump';
import { useAccountStore } from '../stores/account-store';
import { useEmojiStore } from '../stores/emoji-store';
import { useI18nStore } from '../stores/i18n-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import type { TranslationKey } from '../i18n';
import { chatMentionErrorKey } from '../chat-mention-i18n';
import { Avatar } from './Avatar';
import { EmojiPicker } from './ChatEmoji';
import type { StickerPayload } from './ChatEmoji';
import { AppIcon } from './AppIcon';
import { Nameplate } from './Nameplate';
import { ChatFrame } from '../cosmetics/chat-frames/ChatFrame';
import { formatChatTime } from './chat-time';
import { GROUP_GAP_MS, groupMessages } from '../messages/message-groups';
import type { MessageGroup } from '../messages/message-groups';
import { ChatMentionComposer } from './ChatMentionComposer';
import { ChatRoomMentionBody } from './ChatRoomMentionBody';
import { EMPTY_MENTION_DRAFT, CHAT_MAX_LENGTH, isMentioned, mentionCandidates, prepareMentionMessage, replaceMentionRange } from './chat-mentions';
import { chatLogShown, useChatMentionReading } from './use-chat-mention-reading';
import styles from './ChatPanel.module.css';

function ChatTime({ timestamp }: { readonly timestamp: number }): ReactNode {
  return <time className={styles.chatTime} dateTime={new Date(timestamp).toISOString()}>
    {formatChatTime(timestamp)}</time>;
}

/** Notices and observer-only lines never merge into a player's run, so each keeps its own marker. */
function canJoinGroup(previous: ChatMessage, next: ChatMessage): boolean {
  return !previous.system && !next.system && previous.audience === next.audience;
}

// Composer edits leave existing message artwork and emoji text unchanged.
const ChatMessageGroupRow = memo(function ChatMessageGroupRow({ group, room, viewerId }: {
  readonly group: MessageGroup<ChatMessage>;
  readonly room: RoomInfo | null;
  readonly viewerId: string | null;
}): ReactNode {
  const { t } = useI18nStore();
  const first = group.messages[0];
  if (first.system) return <p className={styles.systemMessage} data-chat-message-id={first.id}>
    <ChatTime timestamp={first.timestamp} />{' '}
    {t(first.content as TranslationKey, { name: first.sender.nickname })}
  </p>;
  return <div className={styles.chatMessage}>
    <span className={styles.chatAvatar}>
      <Avatar avatar={first.sender.avatar} image={first.sender.avatarImage} border={first.sender.avatarBorder} color={first.sender.color} size="compact" />
    </span>
    <div className={styles.chatBody}>
      <div className={styles.chatHeading}>
        <span className={styles.chatSender}>{first.sender.nickname}</span>
        <Nameplate id={first.sender.nameplate} />
        {first.audience === 'observers' && <span className={styles.observerTag}
          title={t('chat.observerTitle')}>{t('chat.observerTag')}</span>}
        <ChatTime timestamp={first.timestamp} />
      </div>
      {group.messages.map((message, index) => <div key={message.id} data-chat-message-id={message.id}
        data-chat-mentioned={isMentioned(message.content, message.mentions, viewerId) || undefined}
        className={styles.messageRow}>
        <ChatFrame id={message.sender.chatFrame} className={styles.chatContent}>
          {index > 0 && <span className={styles.srOnly}>{message.sender.nickname}: </span>}
          <ChatRoomMentionBody message={message} room={room} />
        </ChatFrame>
      </div>)}
    </div>
  </div>;
});

interface ChatPanelProps {
  /** When provided: the panel fills the container height and the header shows a collapse button */
  onCollapse?: () => void;
  /** Fills a dock that already has its own tab and collapse button, so the panel drops its header. */
  embedded?: boolean;
  /** Shares a dock tab with other content: a small "Chat" caption with the new-message hint leads the panel. */
  captioned?: boolean;
}

/** Pixels from the end of the log that still count as reading the latest message. */
const BOTTOM_SLACK = 24;
/** How long the hint stays once the latest messages are in view. */
const FRESH_HINT_MS = 5000;

function atBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_SLACK;
}

export function ChatPanel({ onCollapse, embedded = false, captioned = false }: ChatPanelProps): ReactNode {
  const messages = useChatStore((state) => state.messages);
  const emojis = useEmojiStore((state) => state.emojis);
  const loadEmojis = useEmojiStore((state) => state.load);
  const { t } = useI18nStore();
  // During a match, observers' messages reach only other observers.
  const playerId = usePlayerStore((state) => state.playerId);
  const groups = useMemo(() => groupMessages(messages, playerId ?? '', GROUP_GAP_MS, canJoinGroup),
    [messages, playerId]);
  const room = useRoomStore((state) => state.roomInfo);
  const accountId = useAccountStore((state) => state.account?.id ?? null);
  const viewerId = accountId ?? playerId;
  const candidates = useMemo(() => mentionCandidates(room, viewerId), [room, viewerId]);
  const observing = Boolean(viewerId && room?.observerIds?.includes(viewerId));
  const unreadIds = useChatMentionStore((state) => state.unreadIds);
  const requestJump = useChatMentionStore((state) => state.requestJump);
  const [draft, setDraft] = useState(EMPTY_MENTION_DRAFT);
  const input = draft.text;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const busyRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Follow new messages only while the reader is at the end of the log; scrolling up holds the position.
  const following = useRef(true);
  useChatMentionReading(messagesRef, following, room?.code ?? null, pickerOpen);
  useChatMentionJump(useCallback(() => setPickerOpen(false), []));
  const lastScrollTop = useRef(0);
  const lastSeenId = useRef<string | null>(null);
  // Messages that arrived while the log was hidden or scrolled up.
  const [fresh, setFresh] = useState(0);
  const [scrolledUp, setScrolledUp] = useState(false);
  // Hidden while its dock tab or the dock is closed.
  const [visible, setVisible] = useState(true);

  useLayoutEffect(() => {
    const container = messagesRef.current;
    const previous = lastSeenId.current;
    const latest = messages.at(-1);
    lastSeenId.current = latest?.id ?? null;
    if (!container) return;
    const index = previous === null ? -1 : messages.findIndex((message) => message.id === previous);
    const added = index < 0 ? 0 : messages.length - 1 - index;
    const mine = latest !== undefined && !latest.system && latest.sender.id === playerId && added > 0;
    if (mine) following.current = true;
    const hidden = !chatLogShown(container);
    if (added > 0 && !mine && (hidden || !following.current)) setFresh((count) => count + added);
    if (mine) setFresh(0);
    if (following.current) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages, playerId]);

  // A log shown again (a dock tab, a reopened dock) jumps back to the end it was following.
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    let shown = chatLogShown(container);
    setVisible(shown);
    const observer = new ResizeObserver(() => {
      const now = chatLogShown(container);
      if (now && !shown && following.current) container.scrollTop = container.scrollHeight;
      shown = now;
      setVisible(now);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (fresh === 0 || scrolledUp || !visible) return;
    const timer = setTimeout(() => { if (following.current) setFresh(0); }, FRESH_HINT_MS);
    return () => clearTimeout(timer);
  }, [fresh, scrolledUp, visible]);

  const onScroll = (): void => {
    const container = messagesRef.current;
    if (!container || container.clientHeight === 0) return;
    // Programmatic scrolls only move down, so only a move up stops following.
    const up = container.scrollTop < lastScrollTop.current;
    lastScrollTop.current = container.scrollTop;
    if (atBottom(container)) {
      // Reaching the end after scrolling up reads what arrived meanwhile.
      if (!following.current) setFresh(0);
      following.current = true;
    } else if (up) following.current = false;
    setScrolledUp(!following.current);
  };

  const showLatest = (): void => {
    following.current = true;
    setScrolledUp(false);
    setFresh(0);
    const container = messagesRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  };
  const freshLabel = t('chat.newMessages', { n: String(fresh) });

  useEffect(() => { void loadEmojis(); }, [loadEmojis]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-emoji-picker]')) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const insertEmoji = (name: string): void => {
    const field = inputRef.current;
    const start = field?.selectionStart ?? input.length;
    const end = field?.selectionEnd ?? input.length;
    const token = `:${name}:`;
    if (input.length - (end - start) + token.length > CHAT_MAX_LENGTH || busyRef.current) return;
    setDraft(replaceMentionRange(draft, start, end, token));
    setPickerOpen(false);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const prepared = prepareMentionMessage(draft, candidates);
    if (!prepared.ok) { setError(t(prepared.error)); return; }
    const payload = prepared.payload;
    if (!payload.message || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('chat:send', payload, (timeout, result) => {
      busyRef.current = false;
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success) setDraft(EMPTY_MENTION_DRAFT);
      else {
        const key = chatMentionErrorKey(result.error);
        setError(key ? t(key) : result.error ?? t('common.error'));
      }
    });
  };

  const sendSticker = (payload: StickerPayload): void => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('chat:send', payload, (timeout, result) => {
      busyRef.current = false;
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (!result.success) setError(result.error ?? t('common.error'));
      else setPickerOpen(false);
    });
  };

  return (
    <section data-chat-panel className={`${styles.chatContainer} ${onCollapse || embedded ? styles.fill : ''} ${embedded ? styles.embedded : ''}`}>
      {captioned && <div className={styles.caption}>
        <h3 className={styles.captionTitle}>{t('chat.title')}</h3>
        {fresh > 0 && <button type="button" className={styles.freshHint} onClick={showLatest}>{freshLabel}</button>}
      </div>}
      {!embedded && <div className={styles.chatHeader}>
        <h2 className={styles.chatTitle}><AppIcon name="chat" /> {t('chat.title')}</h2>
        {onCollapse && <button type="button" className={`${styles.collapseBtn} touch-target`} onClick={onCollapse}
          aria-label={t('table.chatCollapse')} title={t('table.chatCollapse')}><AppIcon name="nextPage" /></button>}
      </div>}
      <div className={styles.messageArea}>
        <div ref={messagesRef} className={styles.chatMessages} role="log" aria-live="polite" onScroll={onScroll}>
          {groups.map((group) => <ChatMessageGroupRow key={group.key} group={group} room={room} viewerId={viewerId} />)}
        </div>
        {unreadIds.length > 0 && <button type="button" className={styles.mentionUnread}
          onClick={() => requestJump(unreadIds[0])}>{t('chatMention.unread', { n: String(unreadIds.length) })}</button>}
        {!captioned && scrolledUp && fresh > 0 && <button type="button" className={styles.freshPill}
          onClick={showLatest}>{freshLabel} <AppIcon name="nextPage" /></button>}
        {pickerOpen && <div data-emoji-picker>
          <EmojiPicker personal={emojis} provided={PROVIDED_EMOJIS} busy={busy} onInsert={insertEmoji} onSendSticker={sendSticker} />
        </div>}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {observing && <p className={styles.observerNotice}>{t('chat.observerNotice')}</p>}
      <form className={styles.chatInputRow} onSubmit={send}>
        <button type="button" className={styles.pickerBtn} data-emoji-picker
          aria-label={t('emoji.picker')} title={t('emoji.picker')} aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}><AppIcon name="emoji" /></button>
        <ChatMentionComposer draft={draft} onChange={setDraft} candidates={candidates} inputRef={inputRef} busy={busy} />
        <button type="submit" className={styles.chatSendBtn} disabled={busy || !input.trim()}>
          {t('chat.send')}</button>
      </form>
    </section>
  );
}
