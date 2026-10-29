// ─── CardLabel: a card as short text, with red suits and jokers coloured ───

import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { isJoker } from '@shared/rules/cards';
import type { CardOrJoker, Suit } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import styles from './CardLabel.module.css';

/** Text colour class for a suit symbol, so red suits read as red. */
export function suitClass(suit: Suit): string | undefined {
  return suit === 'hearts' || suit === 'diamonds' ? styles.red : undefined;
}

export function CardLabel({ card, className }: { card: CardOrJoker; className?: string }): ReactNode {
  const { t } = useI18nStore();
  if (isJoker(card)) {
    return <span className={`${card.joker === 'big' ? styles.bigJoker : styles.smallJoker} ${className ?? ''}`}>
      {t(`cards.jokerShort.${card.joker}`)}</span>;
  }
  return <span className={`${suitClass(card.suit) ?? ''} ${className ?? ''}`}>
    <span className={styles.suit}>{SUIT_SYMBOLS[card.suit]}</span>{RANK_DISPLAY[card.rank]}</span>;
}
