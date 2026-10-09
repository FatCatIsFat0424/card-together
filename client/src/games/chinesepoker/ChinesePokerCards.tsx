// Static, slightly overlapped card row shared by the arranging view, the showdown, and the result.

import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card } from '@shared/types';
import { cardImageUrl } from '../../cards';
import styles from './ChinesePokerCards.module.css';

export function cardName(card: Card): string {
  return `${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`;
}

/** Card width comes from the parent's `--cp-card-w`, so each view sizes the same markup. */
export function CardRow({ cards, className }: { cards: readonly Card[]; className?: string }): ReactNode {
  return <span className={`${styles.row} ${className ?? ''}`} role="img" aria-label={cards.map(cardName).join(' ')}>
    {cards.map((card) => <img key={`${card.suit}-${card.rank}`} className={styles.card} src={cardImageUrl(card)}
      alt="" draggable={false} />)}
  </span>;
}
