import type { CSSProperties, ReactNode } from 'react';
import type { Card, CardFaceStyleId } from '@shared/types';
import type { PreviewAccount } from '../preview-props';
import { jokerFaceUrl } from './card-faces';
import { useDeckFaceUrl } from './use-card-face';
import styles from './CardFacePreview.module.css';

// Covers both colours, every suit, a court card, an ace, and the joker.
const SAMPLE_CARDS: readonly Card[] = [
  { rank: 14, suit: 'spades' },
  { rank: 13, suit: 'hearts' },
  { rank: 12, suit: 'diamonds' },
  { rank: 10, suit: 'clubs' },
];

export function CardFacePreview({ id }: { readonly id: CardFaceStyleId; readonly account: PreviewAccount }): ReactNode {
  const faceUrl = useDeckFaceUrl(id);
  const urls = [...SAMPLE_CARDS.map(faceUrl), jokerFaceUrl(id)];
  const middle = (urls.length - 1) / 2;
  return <div className={styles.fan} aria-hidden="true">
    <div className={styles.row}>
      {urls.map((url, index) => {
        const offset = index - middle;
        const fan = { '--tilt': `${offset * 8}deg`, '--drop': `${Math.abs(offset) * 3}px` } as CSSProperties;
        return url ? <img key={index} className={styles.card} style={fan} src={url} alt="" draggable={false} /> : null;
      })}
    </div>
  </div>;
}
