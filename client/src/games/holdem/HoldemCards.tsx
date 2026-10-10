import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Card, Seat } from '@shared/types';
import { cardImageUrl } from '../../cards';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { HE_BOARD_SLOTS } from './holdem-view';
import type { HoldemBlindSeats } from './holdem-view';
import styles from './HoldemCards.module.css';

export type CardSize = 'xs' | 'sm' | 'md' | 'lg';

export function cardName(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
}

/**
 * A row of face-up cards, plus `backs` face-down cards. Cards from `freshFrom` on animate in so a
 * presentation can show which cards just arrived.
 */
export function HeCards({ cards, backs = 0, size = 'md', freshFrom, overlap = false, label, peek = false }: {
  cards: readonly Card[]; backs?: number; size?: CardSize; freshFrom?: number; overlap?: boolean; label?: string;
  /** God view: cards the players cannot see, drawn face up but marked as hidden */
  peek?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <span className={`${styles.cards} ${styles[size]} ${overlap ? styles.overlap : ''}`}
    role={label ? 'group' : undefined} aria-label={label}>
    {cards.map((card, index) => <img key={`${card.suit}-${card.rank}`}
      className={`${styles.card} ${peek ? styles.peek : ''} ${freshFrom !== undefined && index >= freshFrom ? styles.fresh : ''}`}
      style={{ '--card-index': index - (freshFrom ?? 0) } as CSSProperties}
      src={cardImageUrl(card)} alt={cardName(card)} draggable={false} />)}
    {Array.from({ length: backs }, (_, index) => <span key={`back-${index}`} className={`${styles.card} ${styles.back}`}
      role="img" aria-label={t('holdem.hiddenCard')} />)}
  </span>;
}

/** The five board slots; undealt streets stay as empty outlines. */
export function Board({ cards, size = 'md', freshFrom }: {
  cards: readonly Card[]; size?: CardSize; freshFrom?: number;
}): ReactNode {
  const { t } = useI18nStore();
  const empty = Math.max(0, HE_BOARD_SLOTS - cards.length);
  return <span className={`${styles.cards} ${styles.board} ${styles[size]}`} role="group" aria-label={t('holdem.board')}>
    {cards.map((card, index) => <img key={`${card.suit}-${card.rank}`}
      className={`${styles.card} ${freshFrom !== undefined && index >= freshFrom ? styles.fresh : ''}`}
      style={{ '--card-index': index - (freshFrom ?? 0) } as CSSProperties}
      src={cardImageUrl(card)} alt={cardName(card)} draggable={false} />)}
    {Array.from({ length: empty }, (_, index) => <span key={`slot-${index}`} className={`${styles.card} ${styles.slot}`}
      aria-hidden="true" />)}
  </span>;
}

/** A stack of chips with its amount, drawn in front of the seat that staked it. */
export function BetStack({ amount, title }: { amount: number; title?: string }): ReactNode {
  return <span className={styles.stack} title={title}>
    <span className={styles.stackChips} aria-hidden="true"><span /><span /><span /></span>
    <span className={styles.stackAmount}>{amount}</span>
  </span>;
}

export function ChipAmount({ amount }: { amount: number }): ReactNode {
  return <span className={styles.amount}><ChipIcon />{amount}</span>;
}

/** Dealer button and blind markers for one seat. */
export function SeatMarkers({ seat, blinds }: {
  seat: Seat; blinds: HoldemBlindSeats | null;
}): ReactNode {
  const { t } = useI18nStore();
  if (!blinds) return null;
  return <>
    {blinds.button === seat && <span className={`${styles.marker} ${styles.dealer}`} title={t('holdem.buttonTitle')}>
      {t('holdem.button')}
    </span>}
    {blinds.small === seat && <span className={styles.marker} title={t('holdem.sbTitle')}>{t('holdem.sb')}</span>}
    {blinds.big === seat && <span className={styles.marker} title={t('holdem.bbTitle')}>{t('holdem.bb')}</span>}
  </>;
}
