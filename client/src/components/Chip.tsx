import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
  /** Whether this filter is on; exposed as `aria-pressed`. */
  readonly selected: boolean;
  /** Optional count shown after the label, e.g. products in a filter. */
  readonly count?: number;
}

/** A 28px filter pill that toggles one choice. */
export function Chip({ selected, count, className, type = 'button', children, ...props }: ChipProps): ReactNode {
  return <button {...props} type={type} aria-pressed={selected}
    className={`${styles.chip} ${selected ? styles.selected : ''} ${className ?? ''}`}>
    {children}
    {count !== undefined && <span className={styles.count}>{count}</span>}
  </button>;
}
