// Shared end-of-game dialog for every table: result, history, a peek at the final table, and "Back to room".

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '../components/Button';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { useReplayMode } from './replay-mode';
import styles from './ResultDialog.module.css';

export const resultStyles = {
  table: styles.scoreTable,
  winnerRow: styles.winnerRow,
  note: styles.note,
} as const;

/** A list of the match's tricks or rounds, opened by a button beside "Back to room" below the summary. */
export interface ResultHistory {
  /** Button text with the count, such as "Trick history (13)" */
  readonly label: string;
  readonly content: ReactNode;
}

interface ResultDialogProps {
  title: ReactNode;
  status?: string;
  /** Colour of the title; Bridge shows a defender win in the danger tone, board games a draw in amber. */
  tone?: 'win' | 'lose' | 'draw';
  /** Short line above the title, e.g. Big Two's dragon. */
  eyebrow?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
  history?: ResultHistory | null;
  pending: boolean;
  error: string;
  disabled?: boolean;
  onBack: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Desktop stacks title, summary and actions. Short landscape screens put the actions in a right column beside
 * the summary, so the summary keeps the height; the history then expands inside the summary column.
 */
export function ResultDialog({
  title, status, tone = 'win', eyebrow, wide = false, children, history = null, pending, error, disabled = false, onBack,
}: ResultDialogProps): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const historyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Folds the dialog away so the final position stays readable; one button brings it back.
  const [peeking, setPeeking] = useState(false);
  const gameType = useGameStore((state) => state.visible?.gameType ?? null);
  // Playback shows the recorded result without acting on any live room.
  const replay = useReplayMode();

  useEffect(() => {
    (peeking ? showRef : primaryRef).current?.focus({ preventScroll: true });
  }, [peeking]);

  useEffect(() => {
    if (historyOpen) historyRef.current?.scrollIntoView({ block: 'nearest' });
  }, [historyOpen]);

  // Keep keyboard focus inside the modal dialog.
  const trapFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (peeking) {
    return <div className={`${styles.peek} ${replay ? styles.peekContained : ''}`}>
      <Button ref={showRef} variant="primary" icon="trophy" onClick={() => setPeeking(false)}>
        {t('result.show')}
      </Button>
    </div>;
  }

  const shownHistory = historyOpen && history;
  // During playback it covers only the table, so the transport below stays usable.
  return <div className={`${styles.backdrop} ${replay ? styles.contained : ''}`}>
    <div ref={dialogRef} className={dialogPaperClass(wide ? 'medium' : 'narrow', styles.dialog)} role="dialog"
      aria-modal={!replay} aria-labelledby={titleId} onKeyDown={trapFocus}>
      <header className={`${dialogParts.header} ${styles.header} ${status ? styles.withStatus : ''}`}>
        <div className={styles.heading}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 id={titleId} className={`${styles.title} ${styles[tone]}`}>{title}</h2>
        </div>
        {status && <span className={`${styles.resultStatus} ${styles[tone]}`}>{status}</span>}
        {gameType && <span className={styles.gameName}>{t(`gameType.${gameType}`)}</span>}
      </header>
      <div className={styles.layout}>
        <div className={dialogParts.body}>
          {children}
          {shownHistory && <section ref={historyRef} id={historyId} className={styles.history}
            aria-label={history.label}>{history.content}</section>}
        </div>
        <footer className={`${dialogParts.footer} ${styles.footer}`}>
          {pending && <p className={styles.readiness} role="status">{t('result.returning')}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {history && <Button className={styles.historyButton} icon="info" aria-expanded={historyOpen}
            aria-controls={shownHistory ? historyId : undefined} onClick={() => setHistoryOpen((open) => !open)}>
            {history.label}
          </Button>}
          <Button className={styles.peekButton} icon="spectate" onClick={() => setPeeking(true)}>
            {t('result.viewTable')}
          </Button>
          {!replay && <Button ref={primaryRef} variant="primary" className={styles.back} disabled={pending || disabled}
            onClick={onBack}>
            {t('score.backToRoom')}
          </Button>}
        </footer>
      </div>
    </div>
  </div>;
}
