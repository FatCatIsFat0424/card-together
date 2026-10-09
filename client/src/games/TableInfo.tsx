// Shared info-rail boxes: whose turn it is and the collapsible rules summary.

import type { ReactNode } from 'react';
import styles from './TableInfo.module.css';

export const infoStyles = styles;

export function TurnBox({ text, children }: { text: string; children?: ReactNode }): ReactNode {
  return <section className={styles.box}>
    <p className={styles.turn}>{text}</p>
    {children}
  </section>;
}

export function RulesBox({ title, lines }: { title: string; lines: readonly string[] }): ReactNode {
  return <details className={styles.box}>
    <summary className={styles.caption}>{title}</summary>
    {lines.map((line) => <p key={line} className={styles.note}>{line}</p>)}
  </details>;
}
