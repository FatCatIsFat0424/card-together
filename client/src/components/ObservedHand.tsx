// ─── ObservedHand: another seat's private hand, shown face up in god view ───

import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, RANK_ORDER_DESC, SUIT_DISPLAY_ORDER, SUIT_SYMBOLS } from '@shared/constants';
import { ldIsTruth, ldSortHand } from '@shared/rules/liarsdeck';
import { sortNapoleonHand } from '@shared/rules/napoleon';
import type { BidSuit, Card, CardOrJoker, LiarCard, LiarTableFace, NapoleonCard } from '@shared/types';
import { useCardFaceUrl, useCardOrJokerFaceUrl } from '../cosmetics/card-faces/use-card-face';
import { LiarCardFace } from '../games/liarsdeck/LiarCardFace';
import { useNapoleonCardImageUrl } from '../games/napoleon/napoleon-card-art';
import { napoleonCardText } from '../games/napoleon/napoleon-view';
import { useI18nStore } from '../stores/i18n-store';
import styles from './ObservedHand.module.css';

/** Hands longer than this split into two rows so every card's corner index stays readable. */
const ROW_LIMIT = 7;

/** Splits a hand into at most two rows of nearly equal length. */
export function observedRows<T>(cards: readonly T[]): T[][] {
  if (cards.length <= ROW_LIMIT) return [[...cards]];
  const half = Math.ceil(cards.length / 2);
  return [cards.slice(0, half), cards.slice(half)];
}

/** Cards in display order: suits as in hand sorting, high ranks first. */
export function sortObserved(cards: readonly Card[]): Card[] {
  return SUIT_DISPLAY_ORDER.flatMap((suit) => RANK_ORDER_DESC.flatMap((rank) =>
    cards.filter((card) => card.suit === suit && card.rank === rank)));
}

/** Overlapping cards whose slots shrink before the row could overflow, like the seat card tray. */
function CardRows<T>({ cards, label, render }: {
  cards: readonly T[]; label: string; render: (card: T) => ReactNode;
}): ReactNode {
  return <div className={styles.hand} role="group" aria-label={label}>
    {observedRows(cards).map((row, index) => (
      <div key={index} className={styles.row} style={{ '--row-cards': row.length } as CSSProperties}>
        {row.map((card, slot) => <span key={slot} className={styles.slot}>{render(card)}</span>)}
      </div>
    ))}
  </div>;
}

export function ObservedCards({ cards, owner }: { cards: readonly Card[]; owner: string }): ReactNode {
  const cardImageUrl = useCardFaceUrl();
  const { t } = useI18nStore();
  return <CardRows cards={sortObserved(cards)} label={t('table.observedHand', { name: owner })}
    render={(card) => <img className={styles.card} src={cardImageUrl(card)} draggable={false}
      alt={`${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`} />} />;
}

/** Liar's Deck faces; cards matching the table card are outlined as truths. */
export function ObservedLiarCards({ cards, owner, tableFace }: {
  cards: readonly LiarCard[]; owner: string; tableFace: LiarTableFace;
}): ReactNode {
  const { t } = useI18nStore();
  return <CardRows cards={ldSortHand(cards)} label={t('table.observedHand', { name: owner })}
    render={(card) => <LiarCardFace face={card.face} variant={card.id} label={t(`liarsdeck.face.${card.face}`)}
      className={`${styles.card} ${ldIsTruth(card.face, tableFace) ? styles.truth : ''}`} />} />;
}

/** Napoleon hands, jokers first and trump leading like the player's own hand. */
export function ObservedNapoleonCards({ cards, owner, trump }: {
  cards: readonly NapoleonCard[]; owner: string; trump: BidSuit | null;
}): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  return <CardRows cards={sortNapoleonHand(cards, trump)} label={t('table.observedHand', { name: owner })}
    render={(card) => <img className={styles.card} src={napoleonCardImageUrl(card)} draggable={false}
      alt={napoleonCardText(card, (joker) => t(`napoleon.joker.${joker}`))} />} />;
}

/** Hands that may hold a joker, in the order their owner keeps them. */
export function ObservedJokerCards({ cards, owner }: { cards: readonly CardOrJoker[]; owner: string }): ReactNode {
  const faceUrl = useCardOrJokerFaceUrl();
  const { t } = useI18nStore();
  return <CardRows cards={cards} label={t('table.observedHand', { name: owner })}
    render={(card) => <img className={styles.card} src={faceUrl(card)} draggable={false}
      alt={'joker' in card ? t(`napoleon.joker.${card.joker}`)
        : `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`} />} />;
}
