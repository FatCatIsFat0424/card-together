// ─── TableSeat 元件：牌桌座位（名牌、徽章、牌背） ───

import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Seat } from '@shared/types';
import { rpCardPoints, rpScore } from '@shared/rules/redpoints';
import { cardImageUrl } from '../cards';
import { remainingCards } from '../game-view';
import type { TablePosition } from '../game-view';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import { useRoomStore } from '../stores/room-store';
import { PlayerLink } from './PlayerLink';
import { TurnClock } from './TurnClock';
import styles from './TableSeat.module.css';

const MAX_BACKS = 6;
const MAX_PILE = 6;

interface TableSeatProps {
  seat: Seat;
  position: TablePosition;
  /** 可點選座位（99：指定下一位） */
  onPick?: () => void;
  /** 此座位剛出的牌（變動即重播閃光） */
  moveKey?: number | string;
  suppressTurn?: boolean;
  hideClock?: boolean;
}

export function TableSeat({ seat, position, onPick, moveKey, suppressTurn, hideClock }: TableSeatProps): ReactNode {
  const { t } = useI18nStore();
  const player = useRoomStore((state) => state.roomInfo?.seats[seat].player ?? null);
  const isMe = useRoomStore((state) => state.mySeat === seat);
  const {
    phase, turn, declarer, dealer, playing, bigTwoCards, redPointsCards, ninetyNineCards, locked, captured, busted,
  } = useGameStore(useShallow((state) => ({
    ninetyNineCards: state.ninetyNine?.handCounts[seat] ?? null,
    busted: state.ninetyNine?.eliminated.includes(seat) ?? false,
    phase: state.phase,
    turn: state.currentTurnSeat === seat,
    declarer: state.contract?.declarer === seat,
    dealer: state.dealerSeat === seat,
    playing: state.playing,
    bigTwoCards: state.bigTwo?.handCounts[seat] ?? null,
    redPointsCards: state.redPoints?.handCounts[seat] ?? null,
    locked: state.bigTwo?.phase === 'playing' && state.bigTwo.lockedSeats.includes(seat),
    captured: state.redPoints?.captured[seat] ?? null,
  })));
  const active = !suppressTurn && turn && (phase === 'bidding' || phase === 'playing');
  const cards = bigTwoCards ?? redPointsCards ?? ninetyNineCards ?? remainingCards(seat, playing);

  const redCaptured = captured?.filter((card) => rpCardPoints(card) > 0) ?? [];

  return (
    <div data-table-seat={position} className={`${styles.seat} ${styles[position]} ${active ? styles.turn : ''} ${busted ? styles.out : ''} ${onPick ? styles.pickable : ''}`}
      role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} onClick={onPick}
      onKeyDown={onPick ? (event) => { if (event.key === 'Enter' || event.key === ' ') onPick(); } : undefined}>
      <div className={styles.plate}>
        {player ? <PlayerLink player={player} size="medium" /> : <span className={styles.empty}>—</span>}
        <span className={styles.tags}>
          <span className={styles.seatLabel}>{t(`seat.${seat}`)}</span>
          {isMe && <span className={styles.me}>{t('common.me')}</span>}
          {declarer && <span className={styles.declarer}>{t('table.declarer')}</span>}
          {dealer && phase === 'bidding' && <span className={styles.dealer}>{t('table.dealer')}</span>}
          {locked && <span className={styles.locked}>🔒 {t('bigtwo.locked')}</span>}
          {busted && <span className={styles.locked}>💥 {t('ninetynine.busted')}</span>}
        </span>
        {active && <span className={styles.turnFlag}>▼ {t('table.turn')}</span>}
        {moveKey !== undefined && <span key={moveKey} className={styles.moved} aria-hidden="true" />}
      </div>
      {!hideClock && <TurnClock seat={seat} showBank={isMe} />}
      <div className={styles.stats}>
      {captured && <div className={styles.pile} title={t('redpoints.captured')}>
        <span className={styles.redPoints}>{t('redpoints.points', { n: String(rpScore(captured)) })}</span>
        {redCaptured.length > 0 && <span className={styles.pileCards} aria-hidden="true">
          {redCaptured.slice(-MAX_PILE).map((card) => (
            <img key={`${card.suit}-${card.rank}`} className={styles.pileCard} src={cardImageUrl(card)} alt="" draggable={false} />
          ))}
        </span>}

      </div>}
      {position !== 'bottom' && cards > 0 && <div className={styles.backs}>
        <span className={styles.fan} aria-hidden="true">
          {Array.from({ length: Math.min(cards, MAX_BACKS) }, (_, i) => <span key={i} className={styles.back} />)}
        </span>
        <span className={`${styles.count} ${bigTwoCards !== null ? styles.bigCount : ''}`}>
          {t('table.cards', { n: String(cards) })}
        </span>
      </div>}
      </div>
    </div>
  );
}
