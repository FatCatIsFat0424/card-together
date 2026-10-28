// Shared end-of-game dialog for every table: result, history, and "Back to room".

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button } from '../components/Button';
import { useI18nStore } from '../stores/i18n-store';
import { dialogPaperClass, dialogParts } from '../styles/dialog';
import { useReplayMode } from './replay-mode';
import styles from './ResultDialog.module.css';

export const resultStyles = {
  table: styles.scoreTable,
  winnerRow: styles.winnerRow,
  note: styles.note,
} as const;

interface ResultDialogProps {
  title: ReactNode;
  /** Colour of the title; Bridge shows a defender win in the danger tone. */
  tone?: 'win' | 'lose';
  /** Short line above the title, e.g. Big Two's dragon. */
  eyebrow?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
  pending: boolean;
  error: string;
  disabled?: boolean;
  onBack: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ResultDialog({
  title, tone = 'win', eyebrow, wide = false, children, pending, error, disabled = false, onBack,
}: ResultDialogProps): ReactNode {
  const { t } = useI18nStore();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  // Playback shows the recorded result without acting on any live room.
  const replay = useReplayMode();

  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

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

  // During playback it covers only the table, so the transport below stays usable.
  return <div className={`${styles.backdrop} ${replay ? styles.contained : ''}`}>
    <div ref={dialogRef} className={dialogPaperClass(wide ? 'medium' : 'narrow', styles.dialog)} role="dialog"
      aria-modal={!replay} aria-labelledby={titleId} onKeyDown={trapFocus}>
      <header className={`${dialogParts.header} ${styles.header}`}>
        <div className={styles.heading}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 id={titleId} className={`${styles.title} ${tone === 'lose' ? styles.lose : styles.win}`}>{title}</h2>
        </div>
      </header>
      <div className={dialogParts.body}>{children}</div>
      {!replay && <footer className={`${dialogParts.footer} ${styles.footer}`}>
        {pending && <p className={styles.readiness} role="status">{t('result.returning')}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <Button ref={primaryRef} variant="primary" disabled={pending || disabled} onClick={onBack}>
          {t('score.backToRoom')}
        </Button>
      </footer>}
    </div>
  </div>;
}
