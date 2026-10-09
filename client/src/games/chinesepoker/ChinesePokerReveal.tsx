// Showdown frame for one row: all four seats' cards at their table positions with the row's net points.

import type { CSSProperties, ReactNode } from 'react';
import { cpEvaluate, cpSortHand } from '@shared/rules/chinesepoker';
import type { ChinesePokerRow, Seat } from '@shared/types';
import { tablePosition } from '../../game-view';
import { useGameStore } from '../../stores/game-store';
import { useI18nStore } from '../../stores/i18n-store';
import { useMotionStore } from '../../stores/motion-store';
import { useSeatName } from '../seat-names';
import { CardRow } from './ChinesePokerCards';
import { categoryLabelKey, rowLabelKey, rowNet, signedPoints } from './chinesepoker-view';
import styles from './ChinesePokerReveal.module.css';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const STAGGER_MS = 120;

export function ChinesePokerReveal({ row, bottomSeat }: { row: ChinesePokerRow; bottomSeat: Seat }): ReactNode {
  const result = useGameStore((state) => state.chinesePoker?.result ?? null);
  const reducedMotion = useMotionStore((state) => state.reducedMotion);
  const seatName = useSeatName();
  const { t } = useI18nStore();
  if (!result) return null;
  const net = rowNet(result.matchups, row);

  return <div className={`${styles.reveal} ${reducedMotion ? styles.still : ''}`}
    role="status" aria-live="polite" aria-atomic="true" data-presentation-kind="reveal">
    <strong className={styles.title}>{t(rowLabelKey(row))}</strong>
    <div className={styles.grid}>
      {SEATS.map((seat) => {
        const cards = cpSortHand(result.arrangements[seat][row]);
        const foul = result.fouls.includes(seat);
        const position = tablePosition(seat, bottomSeat);
        // Reveal clockwise from my seat so the order matches the table.
        const order = (SEATS.indexOf(seat) - SEATS.indexOf(bottomSeat) + 4) % 4;
        return <div key={seat} className={`${styles.seat} ${styles[position]}`}
          style={{ '--delay': `${order * STAGGER_MS}ms` } as CSSProperties}>
          <span className={styles.name}>{seatName(seat)}</span>
          <CardRow cards={cards} />
          <span className={styles.meta}>
            {foul ? <span className={styles.foul}>{t('chinesepoker.foul')}</span>
              : <span>{t(categoryLabelKey(cpEvaluate(cards).category))}</span>}
            <strong className={net[seat] > 0 ? styles.gain : net[seat] < 0 ? styles.loss : undefined}>
              {signedPoints(net[seat])}
            </strong>
          </span>
        </div>;
      })}
    </div>
  </div>;
}
