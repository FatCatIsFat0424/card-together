import { memo, useState, useEffect, useMemo, useRef } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { ChatMessage } from '@shared/types';
import { socket } from '../socket';
import { PROVIDED_EMOJIS } from '../provided-emoji';
import { useChatStore } from '../stores/chat-store';
import { useEmojiStore } from '../stores/emoji-store';
import { useI18nStore } from '../stores/i18n-store';
import { usePlayerStore } from '../stores/player-store';
import { useRoomStore } from '../stores/room-store';
import type { TranslationKey } from '../i18n';
import { Avatar } from './Avatar';
import { ChatMessageBody, EmojiPicker } from './ChatEmoji';
import type { StickerPayload } from './ChatEmoji';
import { AppIcon } from './AppIcon';
import { Nameplate } from './Nameplate';
import { ChatFrame } from '../cosmetics/chat-frames/ChatFrame';
import { formatChatTime } from './chat-time';
import { GROUP_GAP_MS, groupMessages } from '../messages/message-groups';
import type { MessageGroup } from '../messages/message-groups';
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
const ChatMessageGroupRow = memo(function ChatMessageGroupRow({ group }: {
  readonly group: MessageGroup<ChatMessage>;
}): ReactNode {
  const { t } = useI18nStore();
  const first = group.messages[0];
  if (first.system) return <p className={styles.systemMessage}>
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
      {group.messages.map((message, index) => <ChatFrame key={message.id} id={message.sender.chatFrame}
        className={styles.chatContent}>
        {index > 0 && <span className={styles.srOnly}>{message.sender.nickname}: </span>}
        <ChatMessageBody message={message} />
      </ChatFrame>)}
    </div>
  </div>;
});

interface ChatPanelProps {
  /** When provided: the panel fills the container height and the header shows a collapse button */
  onCollapse?: () => void;
  /** Fills a dock that already has its own tab and collapse button, so the panel drops its header. */
  embedded?: boolean;
}

export function ChatPanel({ onCollapse, embedded = false }: ChatPanelProps): ReactNode {
  const messages = useChatStore((state) => state.messages);
  const emojis = useEmojiStore((state) => state.emojis);
  const loadEmojis = useEmojiStore((state) => state.load);
  const { t } = useI18nStore();
  // During a match, observers' messages reach only other observers.
  const playerId = usePlayerStore((state) => state.playerId);
  const groups = useMemo(() => groupMessages(messages, playerId ?? '', GROUP_GAP_MS, canJoinGroup),
    [messages, playerId]);
  const observing = useRoomStore((state) => Boolean(playerId && state.roomInfo?.observerIds?.includes(playerId)));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const busyRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const container = messagesRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [messages]);

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
    setInput(input.slice(0, start) + token + input.slice(end));
    setPickerOpen(false);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const send = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const message = input.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    socket.timeout(10000).emit('chat:send', { message }, (timeout, result) => {
      busyRef.current = false;
      setBusy(false);
      if (timeout) setError(t('auth.connectionError'));
      else if (result.success) setInput('');
      else setError(result.error ?? t('common.error'));
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
    <section className={`${styles.chatContainer} ${onCollapse || embedded ? styles.fill : ''} ${embedded ? styles.embedded : ''}`}>
      {!embedded && <div className={styles.chatHeader}>
        <h2 className={styles.chatTitle}><AppIcon name="chat" /> {t('chat.title')}</h2>
        {onCollapse && <button type="button" className={`${styles.collapseBtn} touch-target`} onClick={onCollapse}
          aria-label={t('table.chatCollapse')} title={t('table.chatCollapse')}><AppIcon name="nextPage" /></button>}
      </div>}
      <div className={styles.messageArea}>
        <div ref={messagesRef} className={styles.chatMessages} role="log" aria-live="polite">
          {groups.map((group) => <ChatMessageGroupRow key={group.key} group={group} />)}
        </div>
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
        <input ref={inputRef} className={styles.chatInput} type="text" aria-label={t('chat.placeholder')}
          placeholder={t('chat.placeholder')} value={input} maxLength={500}
          onChange={(event) => setInput(event.target.value)} />
        <button type="submit" className={styles.chatSendBtn} disabled={busy || !input.trim()}>
          {t('chat.send')}</button>
      </form>
    </section>
  );
}
