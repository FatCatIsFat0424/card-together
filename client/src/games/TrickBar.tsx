// ─── TrickBar: one side's progress toward its target as a row of pips, for the contract chips ───

import type { ReactNode } from 'react';
import styles from './TrickChip.module.css';

export type TrickBarTone = 'ours' | 'theirs' | 'pending';

/** Label, pips and count; the three parts are grid cells so both sides' bars line up under each other. */
export function TrickBar({ label, fullLabel = label, count, target, tone, suffix = '', pendingText }: {
  readonly label: string;
  /** Spoken name when the visible label is abbreviated */
  readonly fullLabel?: string;
  /** Null while the side is not yet known; the bar stays empty and shows a dash */
  readonly count: number | null;
  readonly target: number;
  readonly tone: TrickBarTone;
  /** Appended to the count, such as "+" for private discards still to be added */
  readonly suffix?: string;
  /** Screen reader text while the count is unknown */
  readonly pendingText?: string;
}): ReactNode {
  const filled = count === null ? 0 : Math.min(count, target);
  const text = `${count ?? '–'}${count === null ? '' : suffix}/${target}`;
  return <>
    <span className={`${styles.barLabel} ${styles[tone]}`} aria-hidden>{label}</span>
    <span className={`${styles.bar} ${styles[tone]}`} role="progressbar" aria-label={fullLabel}
      aria-valuemin={0} aria-valuemax={target} aria-valuenow={count === null ? undefined : filled}
      aria-valuetext={count === null ? pendingText : `${count}${suffix} / ${target}`}>
      {Array.from({ length: target }, (_, index) => <span key={index}
        className={`${styles.pip} ${index < filled ? styles.filled : ''}`} />)}
    </span>
    <span className={`${styles.count} ${count === null ? styles.pending : ''}`} aria-hidden>{text}</span>
  </>;
}
