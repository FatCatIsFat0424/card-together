import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import type { Seat, TrickRecord } from '@shared/types';
import { useCardFaceUrl } from '../../cosmetics/card-faces/use-card-face';
import { useI18nStore } from '../../stores/i18n-store';
import styles from './TrickHistory.module.css';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

export function TrickHistory({ tricks }: { tricks: readonly TrickRecord[] }): ReactNode {
  const cardImageUrl = useCardFaceUrl();
  const { t } = useI18nStore();
  if (tricks.length === 0) return null;
  return (
    <details className={styles.history}>
      <summary>
        {t('table.trickHistory')} ({tricks.length})
      </summary>
      <ol className={styles.list}>
        {tricks.map((trick, index) => (
          <li key={index} className={styles.trick}>
            <p>
              {t('table.trickNumber', { n: String(index + 1) })} ·{' '}
              {t('table.trickWinner', { seat: t(`seat.${trick.winnerSeat}`) })}
            </p>
            <div className={styles.cards}>
              {Array.from(
                { length: 4 },
                (_, offset) => SEATS[(SEATS.indexOf(trick.leadSeat) + offset) % 4],
              ).map((seat) => {
                const card = trick.cards[seat];
                return (
                  <div key={seat} className={styles.card}>
                    <span>
                      {t(`seat.${seat}`)}
                      {seat === trick.leadSeat && ` · ${t('table.lead')}`}
                    </span>
                    <img
                      src={cardImageUrl(card)}
                      alt={`${RANK_DISPLAY[card.rank]}${SUIT_SYMBOLS[card.suit]}`}
                      draggable={false}
                    />
                    {seat === trick.winnerSeat && (
                      <span className={styles.winner}>{t('table.winner')}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
