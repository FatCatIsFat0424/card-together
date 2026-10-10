import type { CSSProperties, ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { bjIsNatural, bjTotal } from '@shared/rules/blackjack';
import type { BlackjackHand, BlackjackOutcome, Card } from '@shared/types';
import { cardImageUrl } from '../../cards';
import type { TranslationKey } from '../../i18n';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { handNet, signedChips } from './blackjack-view';
import styles from './BlackjackCards.module.css';

export function cardName(card: Card): string {
  return `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`;
}

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

/** "Blackjack", "Soft 17", "23 · Bust", or the plain total. */
export function totalLabel(cards: readonly Card[], split: boolean, t: Translate): string {
  if (cards.length === 0) return '';
  const { total, soft } = bjTotal(cards);
  if (bjIsNatural({ cards, split })) return t('blackjack.natural');
  if (total > 21) return t('blackjack.bustTotal', { n: String(total) });
  return soft && total < 21 ? t('blackjack.soft', { n: String(total) }) : String(total);
}

/**
 * Overlapping face-up cards; `hole` adds the dealer's face-down card. `freshFrom` marks cards from
 * that index on as newly arrived so the presentation can animate them.
 */
export function BjCards({ cards, hole = false, size = 'md', freshFrom }: {
  cards: readonly Card[]; hole?: boolean; size?: 'sm' | 'md' | 'lg'; freshFrom?: number;
}): ReactNode {
  const { t } = useI18nStore();
  return <span className={`${styles.cards} ${styles[size]}`}>
    {cards.map((card, index) => <img key={`${card.suit}-${card.rank}-${index}`}
      className={`${styles.card} ${freshFrom !== undefined && index >= freshFrom ? styles.fresh : ''}`}
      style={{ '--card-index': index - (freshFrom ?? 0) } as CSSProperties}
      src={cardImageUrl(card)} alt={cardName(card)} draggable={false} />)}
    {hole && <span className={`${styles.card} ${styles.back}`} role="img" aria-label={t('blackjack.holeCard')} />}
  </span>;
}

export function OutcomeBadge({ hand, outcome }: { hand: BlackjackHand; outcome: BlackjackOutcome }): ReactNode {
  const { t } = useI18nStore();
  const net = handNet(hand, outcome);
  const tone = net > 0 ? styles.good : net < 0 ? styles.bad : styles.even;
  return <span className={`${styles.badge} ${tone}`}>
    {t(`blackjack.outcome.${outcome}`)} {signedChips(net)}
  </span>;
}

/** One player hand: cards, total, stake markers, and the outcome once settled. */
export function BjHand({ hand, outcome, active = false, size = 'md', label, freshFrom }: {
  hand: BlackjackHand; outcome?: BlackjackOutcome; active?: boolean; size?: 'sm' | 'md' | 'lg';
  label?: string; freshFrom?: number;
}): ReactNode {
  const { t } = useI18nStore();
  const total = totalLabel(hand.cards, hand.split, t);
  const bust = bjTotal(hand.cards).total > 21;
  return <div className={`${styles.hand} ${active ? styles.active : ''} ${hand.done && !active ? styles.done : ''}`}
    aria-current={active || undefined}>
    {label && <span className={styles.handLabel}>{label}</span>}
    <BjCards cards={hand.cards} size={size} freshFrom={freshFrom} />
    <span className={styles.meta}>
      <span className={`${styles.total} ${bust ? styles.bustTotal : ''}`}>{total}</span>
      <span className={styles.bet} title={t('blackjack.bet', { n: String(hand.bet) })}>
        <ChipIcon />{hand.bet}{hand.doubled && <span className={styles.marker} title={t('blackjack.doubled')}> ×2</span>}
      </span>
      {hand.split && <span className={styles.tag}>{t('blackjack.splitTag')}</span>}
      {outcome && <OutcomeBadge hand={hand} outcome={outcome} />}
    </span>
  </div>;
}

/** The dealer's cards: the up card and face-down hole card until it is revealed, then the total. */
export function DealerHand({ cards, holeHidden, size = 'md', freshFrom }: {
  cards: readonly Card[]; holeHidden: boolean; size?: 'sm' | 'md' | 'lg'; freshFrom?: number;
}): ReactNode {
  const { t } = useI18nStore();
  const total = holeHidden ? t('blackjack.dealerShows', { n: String(bjTotal(cards).total) })
    : totalLabel(cards, false, t);
  return <div className={`${styles.hand} ${styles.dealer}`}>
    <span className={styles.handLabel}>{t('blackjack.dealer')}</span>
    {cards.length === 0
      ? <span className={`${styles.cards} ${styles[size]}`} aria-hidden="true">
        <span className={`${styles.card} ${styles.slot}`} /><span className={`${styles.card} ${styles.slot}`} />
      </span>
      : <BjCards cards={cards} hole={holeHidden} size={size} freshFrom={freshFrom} />}
    {cards.length > 0 && <span className={styles.meta}>
      <span className={`${styles.total} ${bjTotal(cards).total > 21 ? styles.bustTotal : ''}`}>{total}</span>
    </span>}
  </div>;
}
