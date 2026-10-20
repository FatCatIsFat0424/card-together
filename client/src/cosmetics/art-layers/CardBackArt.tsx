import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { LayeredArtwork } from './art-layers';
import { LayeredArt } from './LayeredArt';
import styles from './CardBackArt.module.css';

/** The viewer's animated card back while its CSS image is left empty; null keeps the CSS image. */
export const CardBackArtContext = createContext<LayeredArtwork | null>(null);

/** First child of a card back element, in place of its `::before` image. */
export function CardBackArt(): ReactNode {
  const art = useContext(CardBackArtContext);
  return art && <LayeredArt art={art} fit="cover" className={styles.back} />;
}
