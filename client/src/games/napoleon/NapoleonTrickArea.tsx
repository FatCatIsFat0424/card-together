// ─── NapoleonTrickArea: the trick in progress for four to six seats ───

import type { CSSProperties, ReactNode } from 'react';
import type { GameSeat, NapoleonTrick } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { useI18nStore } from '../../stores/i18n-store';
import { useSeatName } from '../seat-names';
import { useNapoleonCardImageUrl } from './napoleon-card-art';
import { napoleonCardText } from './napoleon-view';
import styles from './NapoleonTrickArea.module.css';

/** Where a seat's card lies: around an ellipse, the viewer at the bottom and clockwise seats to their left. */
export function napoleonTrickSlot(
  seat: GameSeat, bottomSeat: GameSeat, seats: readonly GameSeat[],
): { readonly left: number; readonly top: number; readonly angle: number } {
  const from = seats.includes(bottomSeat) ? seats.indexOf(bottomSeat) : 0;
  const relative = (seats.indexOf(seat) - from + seats.length) % seats.length;
  const angle = (relative / seats.length) * 2 * Math.PI;
  const round = (value: number): number => Math.round(value * 10) / 10;
  // The taller vertical radius keeps the two cards on one side of a six-player table (and their names) apart.
  return { left: round(50 - Math.sin(angle) * 36), top: round(50 + Math.cos(angle) * 34), angle };
}

export function NapoleonTrickArea({ trick, seats, bottomSeat, myTurn }: {
  trick: NapoleonTrick | null;
  seats: readonly GameSeat[];
  bottomSeat: GameSeat;
  myTurn: boolean;
}): ReactNode {
  const napoleonCardImageUrl = useNapoleonCardImageUrl();
  const { t } = useI18nStore();
  const name = useSeatName();
  const jokerName = (joker: 'big' | 'small'): string => t(`napoleon.joker.${joker}`);
  const plays = trick?.plays ?? [];
  const slotStyle = (seat: GameSeat): CSSProperties => {
    const slot = napoleonTrickSlot(seat, bottomSeat, seats);
    return { left: `${slot.left}%`, top: `${slot.top}%`,
      '--fly-x': `${Math.round(-Math.sin(slot.angle) * 30)}vw`, '--fly-y': `${Math.round(Math.cos(slot.angle) * 28)}vh` } as CSSProperties;
  };

  return (
    <div className={styles.trickContainer}>
      {plays.map(({ seat, card }) => (
        <div key={seat} className={styles.slot} style={slotStyle(seat)}>
          <div key={napoleonCardText(card, jokerName)} className={styles.trickCard} role="img"
            aria-label={`${name(seat)} ${napoleonCardText(card, jokerName)}`}>
            <img src={napoleonCardImageUrl(card)} alt="" draggable={false} />
          </div>
          <span className={styles.who}>
            <span className={styles.name}>{name(seat)}</span>
            {seat === trick?.leadSeat && <span className={styles.lead}>{t('table.lead')}</span>}
          </span>
        </div>
      ))}
      {myTurn && !plays.some((play) => play.seat === bottomSeat) && <div className={`${styles.slot} ${styles.placeholder}`}
        style={slotStyle(bottomSeat)}>{t('table.yourCard')}</div>}
      {trick?.leadSuit && plays.length > 0 && <span className={styles.leadSuit}>
        {t('napoleon.leadSuit', { suit: SUIT_SYMBOLS[trick.leadSuit] })}
      </span>}
    </div>
  );
}
