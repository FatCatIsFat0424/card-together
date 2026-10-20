import type { ReactNode } from 'react';
import type { LayeredArtwork } from './art-layers';
import { LayeredArt } from './LayeredArt';
import styles from './TableArt.module.css';

/** First child of a `customTable` surface whose `::before` image is replaced by layers. */
export function TableArt({ art }: { art: LayeredArtwork }): ReactNode {
  return <span className={styles.table} aria-hidden="true">
    <LayeredArt art={art} fit="cover" className={styles.art} />
    <span className={styles.tint} />
  </span>;
}
