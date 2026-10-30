import { useEffect, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomNoticeStore } from '../stores/room-notice-store';
import { ActionButton } from './ActionButton';
import { AppIcon } from './AppIcon';
import { IconButton } from './IconButton';
import styles from './RoomHeader.module.css';

const COPIED_MS = 2000;

export interface RoomHeaderStatus {
  readonly text: string;
  /** `turn` highlights the pill, as when it is the viewer's turn. */
  readonly tone?: 'default' | 'turn';
}

export interface RoomHeaderChat {
  readonly unread: number;
  readonly expanded: boolean;
  /** Id of the panel the button shows and hides. */
  readonly controls: string;
  readonly onToggle: () => void;
}

/**
 * The one header row of the waiting room and the live table: back, game name, and room code on the left, a status
 * pill in the middle, then rules, voice, and chat, and after a divider the actions of the current phase with the
 * exit last. A room notice, such as a passed abort vote, takes the pill's place while it shows.
 */
export function RoomHeader({
  title, code, status, voice, chat, chatRef, actions, onBack, onRules, onCopyFailed, className = '',
}: {
  readonly title: string;
  readonly code: string;
  readonly status: RoomHeaderStatus | null;
  /** The voice control, which owns the call panel's placement. */
  readonly voice: ReactNode;
  readonly chat: RoomHeaderChat | null;
  /** The chat button, for returning focus when the chat closes. */
  readonly chatRef?: Ref<HTMLButtonElement>;
  /** The phase's own actions; the exit comes last. */
  readonly actions: ReactNode;
  readonly onBack: () => void;
  readonly onRules: () => void;
  readonly onCopyFailed?: () => void;
  readonly className?: string;
}): ReactNode {
  const { t } = useI18nStore();
  const notice = useRoomNoticeStore((state) => state.notice);
  const [copied, setCopied] = useState(false);

  useEffect(() => useRoomNoticeStore.getState().attachHeader(), []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = (): void => {
    if (!navigator.clipboard) { onCopyFailed?.(); return; }
    navigator.clipboard.writeText(code).then(() => setCopied(true), () => onCopyFailed?.());
  };
  const noticeText = notice ? t(notice.key) : '';
  const pill = noticeText || status?.text;
  const chatLabel = chat && chat.unread > 0 ? `${t('chat.title')} ${t('room.unread', { n: String(chat.unread) })}`
    : t('chat.title');

  return <header className={`${styles.header} ${className}`} data-room-header>
    <IconButton icon="previousPage" label={t('room.back')} onClick={onBack} />
    <h1 className={styles.title}>{title}</h1>
    <button type="button" className={styles.codeChip} onClick={copy}
      aria-label={`${t('room.copyCode')} ${code}`} title={t('room.copyCode')}>
      <span>{code}</span>
      <AppIcon name={copied ? 'check' : 'copy'} />
    </button>
    <div className={styles.centre}>
      {pill && <p className={styles.status} data-tone={noticeText ? 'notice' : status?.tone ?? 'default'}
        data-room-status title={pill}>{pill}</p>}
    </div>
    <span className={styles.srOnly} role="status">{copied ? t('room.copied') : noticeText}</span>
    <div className={styles.actions}>
      <ActionButton icon="rules" text={t('room.action.rules')} label={t('rules.open')} collapsible
        aria-haspopup="dialog" onClick={onRules} />
      {voice}
      {chat && <ActionButton icon="chat" text={t('chat.title')} collapsible ref={chatRef} badge={chat.unread}
        label={chatLabel} aria-expanded={chat.expanded} aria-controls={chat.controls} onClick={chat.onToggle} />}
    </div>
    <span className={styles.divider} aria-hidden="true" />
    <div className={styles.actions} data-phase-actions>{actions}</div>
  </header>;
}
