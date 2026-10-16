import type { ReactNode } from 'react';
import type { ChipStyleId } from '@shared/types';
import type { PreviewAccount } from '../preview-props';
import { ChipDisc } from './ChipDisc';
import styles from './ChipStylePreview.module.css';

const SAMPLE_AMOUNT = '1,280';

/** Shows the chip large, as a short fanned row, and at text size beside an amount. */
export function ChipStylePreview({ id }: { readonly id: ChipStyleId; readonly account: PreviewAccount }): ReactNode {
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.row}>
        <ChipDisc style={id} className={`${styles.chip} ${styles.left}`} />
        <ChipDisc style={id} className={`${styles.chip} ${styles.right}`} />
        <ChipDisc style={id} className={`${styles.chip} ${styles.front}`} />
      </div>
      <span className={styles.amount}>
        <ChipDisc style={id} className={styles.inline} />{SAMPLE_AMOUNT}
      </span>
    </div>
  );
}
