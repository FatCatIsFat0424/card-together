// Shared info-rail box showing whose turn it is.

import type { ReactNode } from 'react';
import styles from './TableInfo.module.css';

export const infoStyles = styles;

export function TurnBox({ text, children }: { text: string; children?: ReactNode }): ReactNode {
  return <section className={styles.box}>
    <p className={styles.turn}>{text}</p>
    {children}
  </section>;
}
