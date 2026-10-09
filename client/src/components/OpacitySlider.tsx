import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { IMAGE_OPACITY_MAX, IMAGE_OPACITY_MIN } from '@shared/constants';
import styles from './OpacitySlider.module.css';

const COMMIT_DELAY_MS = 400;

interface OpacitySliderProps {
  readonly id: string;
  readonly label: string;
  /** Integer percent currently shown, including an uncommitted drag. */
  readonly value: number;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
  /** Called once per pause or release so dragging does not save every step. */
  readonly onCommit: (value: number) => void;
}

export function OpacitySlider({
  id, label, value, disabled, onChange, onCommit,
}: OpacitySliderProps): ReactNode {
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });

  const flush = (): void => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    commit.current(next);
  };

  // Leaving the page mid-drag still saves the last chosen value.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current !== null) commit.current(pending.current);
  }, []);

  return (
    <label htmlFor={id} className={styles.slider}>
      <span>{label}</span>
      <input id={id} type="range" min={IMAGE_OPACITY_MIN} max={IMAGE_OPACITY_MAX} step={1}
        value={value} disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(next);
          pending.current = next;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, COMMIT_DELAY_MS);
        }}
        onPointerUp={flush} onBlur={flush} />
      <output htmlFor={id}>{value}%</output>
    </label>
  );
}
