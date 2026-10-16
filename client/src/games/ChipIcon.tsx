import type { ReactNode } from 'react';
import { ChipDisc } from '../cosmetics/chip-styles/ChipDisc';
import { useChipStyle } from '../cosmetics/chip-styles/use-chip-style';
import styles from './ChipIcon.module.css';

/** A drawn chip for match-only chip amounts; the coin emoji is missing from many system fonts. */
export function ChipIcon(): ReactNode {
  const style = useChipStyle();
  if (style) return <ChipDisc style={style} className={styles.chipDisc} />;
  return <span className={styles.chipIcon} aria-hidden="true" />;
}
