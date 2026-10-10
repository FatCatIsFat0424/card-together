import type { ReactNode } from 'react';
import styles from './ChipIcon.module.css';

/** A drawn chip for match-only chip amounts; the coin emoji is missing from many system fonts. */
export function ChipIcon(): ReactNode {
  return <span className={styles.chipIcon} aria-hidden="true" />;
}
