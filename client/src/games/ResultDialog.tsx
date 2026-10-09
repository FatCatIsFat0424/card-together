// Shared end-of-game dialog for every table: result, history, and "Back to room".

import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useI18nStore } from '../stores/i18n-store';
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

  return <div className={styles.backdrop}>
    <div ref={dialogRef} className={`${styles.dialog} ${wide ? styles.wide : ''}`} role="dialog" aria-modal="true"
      aria-labelledby={titleId} onKeyDown={trapFocus}>
      {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      <h2 id={titleId} className={`${styles.title} ${tone === 'lose' ? styles.lose : styles.win}`}>{title}</h2>
      {children}
      {pending && <p className={styles.readiness} role="status">{t('result.returning')}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button ref={primaryRef} type="button" className={`btn btn-primary ${styles.primary}`}
        disabled={pending || disabled} onClick={onBack}>{t('score.backToRoom')}</button>
    </div>
  </div>;
}
