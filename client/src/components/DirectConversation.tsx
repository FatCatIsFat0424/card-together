import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DirectMessage, MessageHistory, MessageInput } from '@shared/types/direct-message';
import { apiRequest } from '../api';
import { createMessageClientId } from '../messages/message-client-id';
import { latestIncomingMessageId, mergeDirectMessages } from '../messages/message-history';
import { AppIcon } from './AppIcon';
import { MessageHeading } from './MessageConversations';
import { ChatMessageBody, EmojiPickerSections } from './ChatEmoji';
import type { StickerPayload } from './ChatEmoji';
import { PlayerLink } from './PlayerLink';
import { PROVIDED_EMOJIS } from '../provided-emoji';
import { useAccountStore } from '../stores/account-store';
import { useEmojiStore } from '../stores/emoji-store';
import { useI18nStore } from '../stores/i18n-store';
import { useSocialStore } from '../stores/social-store';
import chatStyles from './ChatPanel.module.css';
import styles from './DirectMessages.module.css';

export function DirectConversation({ ownId, otherId }: {
  readonly ownId: string; readonly otherId: string;
}): ReactNode {
  const { locale, t } = useI18nStore();
  const revision = useSocialStore((state) => state.revision);
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
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'emoji' | 'sticker'>('emoji');
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
  const current = (): boolean => mounted.current && useAccountStore.getState().account?.id === ownId;

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
    if (!result.success) { scrollBefore.current = null; refreshAfterPage.current = false; setError(result.error); return; }
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
  }, [load, revision]);

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
    <MessageHeading onRefresh={() => void load()} disabled={loading || paging} />
    <section className={styles.conversation} aria-label={t('messages.title')}>
    <header className={styles.header}>
      <Link to="/friends?tab=messages"><AppIcon name="previousPage" /> {t('messages.back')}</Link>
      {history && <PlayerLink player={history.account} showUsername size="medium" />}
    </header>
    {loading && <p className={styles.notice} role="status">{t('common.loading')}</p>}
    {error && <div className={styles.notice} role="alert"><p>{error}</p>
      <button type="button" className="btn btn-outline" onClick={() => void load()}>{t('common.retry')}</button></div>}
    <div ref={messagesRef} className={styles.messages} role="log" aria-live="polite" aria-relevant="additions" aria-busy={loading || paging}>
      {history?.hasMore && <button type="button" className="btn btn-outline" disabled={paging}
        onClick={() => void load(history.messages[0]?.id)}>
        {paging ? t('common.loading') : t('messages.older')}</button>}
      {history?.messages.length === 0 && <p className={styles.empty}>{t('messages.emptyConversation')}</p>}
      {history?.messages.map((message) => <article key={message.id}
        className={`${styles.message} ${message.sender.id === ownId ? styles.ownMessage : ''}`}>
        <div className={styles.messageMeta}><span>{message.sender.nickname}</span>
          <time dateTime={new Date(message.timestamp).toISOString()}>
            {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(message.timestamp)}</time>
        </div>
        <div className={styles.messageContent}><ChatMessageBody message={message} /></div>
      </article>)}
    </div>
    {readError && <p className={styles.notice} role="alert">{t('common.error')}{' '}
      <button type="button" className="btn btn-outline" onClick={() => void markVisible()}>{t('common.retry')}</button></p>}
    {sendFailed && <p className={styles.notice} role="alert">{t('messages.sendFailed')}{' '}
      <button type="button" className="btn btn-outline" disabled={busy || !history?.canSend}
        onClick={() => { if (pending.current) void send(pending.current.payload, true); }}>{t('messages.retrySend')}</button></p>}
    {history && !history.canSend && <p className={styles.notice}>{t('messages.formerFriend')}</p>}
    {history?.canSend && <div className={styles.composer}>
      {pickerOpen && <div className={`${chatStyles.picker} ${mode === 'sticker' ? chatStyles.stickerPicker : ''}`}
        data-direct-picker>
        <div className={chatStyles.pickerTabs}>
          <button type="button" aria-pressed={mode === 'emoji'} onClick={() => setMode('emoji')}>{t('emoji.title')}</button>
          <button type="button" aria-pressed={mode === 'sticker'} onClick={() => setMode('sticker')}>{t('sticker.mode')}</button>
        </div>
        <input type="search" className={chatStyles.pickerSearch} value={search} autoFocus
          aria-label={t('emoji.search')} placeholder={t('emoji.search')} onChange={(event) => setSearch(event.target.value)} />
        <EmojiPickerSections mode={mode} query={search.trim().toLowerCase()} personal={emojis}
          provided={PROVIDED_EMOJIS} busy={busy} onInsert={insertEmoji}
          onSendSticker={(payload: StickerPayload) => void send(payload)} />
      </div>}
      <form className={chatStyles.chatInputRow} onSubmit={submit}>
        <button type="button" className={chatStyles.pickerBtn} data-direct-picker disabled={busy}
          aria-label={t('emoji.picker')} aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
          <AppIcon name="emoji" /></button>
        <input ref={inputRef} type="text" className={chatStyles.chatInput} maxLength={500} value={input} disabled={busy}
          aria-label={t('chat.placeholder')} placeholder={t('chat.placeholder')} onChange={(event) => setInput(event.target.value)} />
        <button type="submit" className={chatStyles.chatSendBtn} disabled={busy || !input.trim()}>{t('chat.send')}</button>
      </form>
    </div>}
    </section>
  </>;
}
