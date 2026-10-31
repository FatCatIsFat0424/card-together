import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useI18nStore } from '../stores/i18n-store';
import { Avatar } from './Avatar';
import { CHAT_MAX_LENGTH, editMentionDraft, insertMention, mentionKeyAction, mentionQuery, searchMentionCandidates } from './chat-mentions';
import type { MentionCandidate, MentionDraft } from './chat-mentions';
import styles from './ChatPanel.module.css';

export function ChatMentionComposer({ draft, onChange, candidates, inputRef, busy }: {
  readonly draft: MentionDraft;
  readonly onChange: (draft: MentionDraft) => void;
  readonly candidates: readonly MentionCandidate[];
  readonly inputRef: RefObject<HTMLTextAreaElement | null>;
  readonly busy: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const id = useId();
  const composerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const beforeEdit = useRef<{ start: number; end: number } | undefined>(undefined);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState({ key: '', index: 0 });
  const query = mentionQuery(draft, selection.start, selection.end);
  const queryKey = query ? `${query.start}:${query.query}` : '';
  const matches = query ? searchMentionCandidates(candidates, query.query) : [];
  const open = focused && !isComposing && query !== null && dismissed !== queryKey && matches.length > 0;
  const selected = Math.min(active.key === queryKey ? active.index : 0, Math.max(0, matches.length - 1));

  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [draft.text, inputRef]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, open]);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    const panel = composer?.closest('[data-chat-panel]');
    if (!composer || !panel) return;
    const measure = (): void => {
      const bounds = panel.getBoundingClientRect();
      const input = composer.getBoundingClientRect();
      composer.style.setProperty('--mention-picker-height', `${Math.max(0, input.top - Math.max(0, bounds.top) - 8)}px`);
      composer.style.setProperty('--mention-picker-width', `${Math.max(0, Math.min(320, bounds.right - input.left - 8))}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(composer);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  const pick = (candidate: MentionCandidate): void => {
    if (!query || busy) return;
    const next = insertMention(draft, query.start, query.end, candidate.player);
    if (next === draft) return;
    onChange(next);
    setDismissed(queryKey);
    const caret = query.start + candidate.player.nickname.length + 2;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
      setSelection({ start: caret, end: caret });
    });
  };
  const select = (): void => {
    const field = inputRef.current;
    if (field) setSelection({ start: field.selectionStart, end: field.selectionEnd });
  };
  let cursor = 0;
  const highlights: ReactNode[] = [];
  for (const mention of draft.mentions) {
    highlights.push(draft.text.slice(cursor, mention.start));
    highlights.push(<span className={styles.composerMention} key={`${mention.start}:${mention.playerId}`}>
      {draft.text.slice(mention.start, mention.end)}</span>);
    cursor = mention.end;
  }
  highlights.push(draft.text.slice(cursor), '\u200b');

  return <div ref={composerRef} className={styles.composer}>
    {open && <div className={styles.mentionPicker}>
      <div ref={listRef} id={id} role="listbox" aria-label={t('chatMention.suggestions')} className={styles.mentionOptions}>
        {matches.map((candidate, index) => <button type="button" role="option" tabIndex={-1}
          id={`${id}-${index}`} key={candidate.player.id} aria-selected={index === selected}
          className={styles.mentionOption} onPointerDown={(event) => event.preventDefault()}
          onClick={() => pick(candidate)}>
          <Avatar avatar={candidate.player.avatar} image={candidate.player.avatarImage} border={candidate.player.avatarBorder}
            color={candidate.player.color} size="compact" />
          <span className={styles.mentionIdentity}><strong>{candidate.player.nickname}</strong>
            <span>@{candidate.player.username}</span></span>
          <span className={styles.mentionSeat}>{candidate.seat === null ? t('chatMention.spectator')
            : t('chatMention.seat', { seat: candidate.seat })}</span>
        </button>)}
      </div>
      <p className={styles.mentionHint}>{t('chatMention.hint')}</p>
    </div>}
    <div ref={overlayRef} className={styles.composerHighlight} aria-hidden="true">{highlights}</div>
    <textarea ref={inputRef} className={styles.mentionInput} rows={1} role="combobox"
      aria-label={t('chat.placeholder')} placeholder={t('chat.placeholder')} aria-autocomplete="list"
      aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${selected}` : undefined}
      value={draft.text} maxLength={CHAT_MAX_LENGTH} readOnly={busy}
      onFocus={() => { setFocused(true); select(); }} onBlur={() => setFocused(false)} onSelect={select}
      onBeforeInput={(event) => {
        beforeEdit.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
      }}
      onPaste={(event) => {
        beforeEdit.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
        // React may skip onChange when pasted text equals the selected token's current text.
        if (!busy && beforeEdit.current.start !== beforeEdit.current.end) {
          onChange(editMentionDraft(draft, draft.text, beforeEdit.current));
        }
      }}
      onCut={(event) => {
        beforeEdit.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
      }}
      onChange={(event) => {
        let replaced = beforeEdit.current;
        const inputType = (event.nativeEvent as InputEvent).inputType ?? '';
        if (replaced && replaced.start === replaced.end && inputType.startsWith('delete')) {
          const removed = Math.max(0, draft.text.length - event.target.value.length);
          replaced = inputType.endsWith('Backward') ? { start: Math.max(0, replaced.start - removed), end: replaced.end }
            : { start: replaced.start, end: replaced.end + removed };
        }
        onChange(editMentionDraft(draft, event.target.value, replaced));
        beforeEdit.current = undefined;
        setDismissed(null);
        setSelection({ start: event.target.selectionStart, end: event.target.selectionEnd });
      }}
      onCompositionStart={() => { composing.current = true; setIsComposing(true); setDismissed(queryKey); }}
      onCompositionEnd={() => { composing.current = false; setIsComposing(false); select(); }}
      onScroll={(event) => {
        if (overlayRef.current) { overlayRef.current.scrollTop = event.currentTarget.scrollTop;
          overlayRef.current.scrollLeft = event.currentTarget.scrollLeft; }
      }}
      onKeyDown={(event) => {
        beforeEdit.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd };
        const action = mentionKeyAction(event.key,
          composing.current || event.nativeEvent.isComposing || event.keyCode === 229, open, event.shiftKey);
        if (!action) return;
        event.preventDefault();
        if (action === 'next') setActive({ key: queryKey, index: (selected + 1) % matches.length });
        else if (action === 'previous') setActive({ key: queryKey, index: (selected + matches.length - 1) % matches.length });
        else if (action === 'dismiss') setDismissed(queryKey);
        else if (action === 'select') pick(matches[selected]);
        else if (!busy) event.currentTarget.form?.requestSubmit();
      }} />
  </div>;
}
