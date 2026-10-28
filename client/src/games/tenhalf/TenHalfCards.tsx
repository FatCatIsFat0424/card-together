import type { CSSProperties, ReactNode } from 'react';
import { thHalves, thHandKind, thPoints } from '@shared/rules/tenhalf';
import type { Card, TenHalfOutcome } from '@shared/types';
import { useCardFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { CardBackArt } from '../../cosmetics/art-layers/CardBackArt';
import type { TranslationKey } from '../../i18n';
import { useI18nStore } from '../../stores/i18n-store';
import { ChipIcon } from '../ChipIcon';
import { cardName } from '../blackjack/BlackjackCards';
import { signedChips } from '../blackjack/blackjack-view';
import { useSortedHand } from '../use-hand-sort';
import { useHandReorder } from '../use-hand-reorder';
// The card rows and hand plates look the same as Blackjack's, so the two games share one stylesheet.
import styles from '../blackjack/BlackjackCards.module.css';

type Translate = (key: TranslationKey, params?: Record<string, string>) => string;

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** "7.5 pts", "11 · Bust", or a special hand's name and multiple. */
export function handLabel(cards: readonly Card[], t: Translate): { text: string; special: boolean; bust: boolean } {
  const kind = thHandKind(cards);
  const n = String(thPoints(thHalves(cards)));
  if (kind === 'bust') return { text: t('tenhalf.bustTotal', { n }), special: false, bust: true };
  if (kind === 'points') return { text: t('tenhalf.total', { n }), special: false, bust: false };
  return { text: t(`tenhalf.kind.${kind}`), special: true, bust: false };
}

/**
 * A hand's cards: the face-down card first, then the face-up draws. A known hole card is drawn face up
 * and marked as hidden from the others until the showdown; an unknown one shows its back.
 * `freshFrom` marks cards from that index on as newly arrived so the presentation can animate them.
 */
export function ThCards({ ups, hole, hidden, size = 'md', freshFrom, sortable = false }: {
  ups: readonly Card[]; hole: Card | null; hidden: boolean; size?: 'sm' | 'md' | 'lg'; freshFrom?: number;
  sortable?: boolean;
}): ReactNode {
  const { cards, canReorder, reorder } = useSortedHand(hole ? [hole, ...ups] : ups, 'tenhalf', sortable);
  const dragProps = useHandReorder(cards, canReorder, reorder);
  const cardImageUrl = useCardFaceUrl();
  const { t } = useI18nStore();
  return <span className={`${styles.cards} ${styles[size]}`}>
    {!hole && hidden && <span className={`${styles.card} ${styles.back}`} role="img" aria-label={t('tenhalf.holeCard')}>
      <CardBackArt />
    </span>}
    {cards.map((card, index) => {
      const concealed = hidden && hole !== null && sameCard(card, hole);
      return <img key={`${card.suit}-${card.rank}`} {...dragProps(index)}
        className={`${styles.card} ${concealed ? styles.peek : ''} ${freshFrom !== undefined && index >= freshFrom ? styles.fresh : ''}`}
        style={{ ...dragProps(index).style, '--card-index': index - (freshFrom ?? 0) } as CSSProperties}
        src={cardImageUrl(card)} alt={concealed ? `${t('tenhalf.ownHole')} ${cardName(card)}` : cardName(card)}
        draggable={false} />;
    })}
  </span>;
}

export function ThOutcomeBadge({ outcome, net }: { outcome: TenHalfOutcome; net: number }): ReactNode {
  const { t } = useI18nStore();
  const tone = net > 0 ? styles.good : net < 0 ? styles.bad : styles.even;
  return <span className={`${styles.badge} ${tone}`}>{t(`tenhalf.outcome.${outcome}`)} {signedChips(net)}</span>;
}

/** One seat's hand: cards, total once the hole card is known, stake, finish mark, and the outcome once settled. */
export function ThHand({
  ups, hole, hidden, bet = 0, outcome, net, active = false, done = false, size = 'md', label, freshFrom, sortable = false,
}: {
  ups: readonly Card[]; hole: Card | null; hidden: boolean; bet?: number; outcome?: TenHalfOutcome | null; net?: number;
  active?: boolean; done?: boolean; size?: 'sm' | 'md' | 'lg'; label?: string; freshFrom?: number; sortable?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const summary = hole ? handLabel([hole, ...ups], t) : null;
  return <div className={`${styles.hand} ${active ? styles.active : ''} ${done && !active ? styles.done : ''}`}
    aria-current={active || undefined}>
    {label && <span className={styles.handLabel}>{label}</span>}
    <ThCards ups={ups} hole={hole} hidden={hidden} size={size} freshFrom={freshFrom} sortable={sortable} />
    <span className={styles.meta}>
      {summary ? <span className={`${styles.total} ${summary.bust ? styles.bustTotal : ''}`}>{summary.text}</span>
        : ups.length > 0 && <span className={styles.total}>
          {t('tenhalf.showing', { n: String(thPoints(thHalves(ups))) })}
        </span>}
      {bet > 0 && <span className={styles.bet} title={t('tenhalf.bet', { n: String(bet) })}><ChipIcon />{bet}</span>}
      {done && !outcome && hidden && <span className={styles.tag}>{t('tenhalf.done')}</span>}
      {outcome && net !== undefined && <ThOutcomeBadge outcome={outcome} net={net} />}
    </span>
  </div>;
}
