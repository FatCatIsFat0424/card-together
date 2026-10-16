// ─── AuctionTable: auction grid (Bridge W N E S; Napoleon its seats in clockwise order) ───

import type { ReactNode } from 'react';
import type { BidSuit, GameSeat } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { AUCTION_COLUMNS, auctionRows, auctionWaitIndex } from '../game-view';
import type { AuctionCall } from '../game-view';
import { compactSeatLabel, seatLabel } from '../games/seat-names';
import { useGameStore } from '../stores/game-store';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AuctionTable.module.css';

export function BidLabel({ level, suit }: { level: number; suit: BidSuit }): ReactNode {
  if (suit === 'nt') return <>{level}NT</>;
  const red = suit === 'hearts' || suit === 'diamonds';
  return <>{level}<span className={red ? styles.suitRed : undefined}>{SUIT_SYMBOLS[suit]}</span></>;
}

interface AuctionTableProps {
  calls: readonly AuctionCall[];
  toAct: GameSeat | null;
  mySeat: GameSeat | null;
  columns?: readonly GameSeat[];
}

export function AuctionTable({ calls, toAct, mySeat, columns = AUCTION_COLUMNS }: AuctionTableProps): ReactNode {
  const { t } = useI18nStore();
  const gameType = useGameStore((state) => state.visible?.gameType);
  const rows = auctionRows(calls, columns);
  const waitIndex = auctionWaitIndex(calls, toAct, columns);
  if (waitIndex >= rows.length * columns.length) rows.push(columns.map(() => null));

  return (
    <table className={styles.table}>
      <thead>
        <tr>{columns.map((seat) => (
          <th key={seat} className={seat === mySeat ? styles.me : undefined} title={seatLabel(t, gameType, seat)}
            aria-label={seatLabel(t, gameType, seat)}>{compactSeatLabel(t, gameType, seat)}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>{row.map((call, c) => (
            <td key={c} className={call?.action.type === 'pass' ? styles.pass : undefined}>
              {call ? (call.action.type === 'pass' ? t('game.pass')
                : <BidLabel level={call.action.level} suit={call.action.suit} />)
                : r * columns.length + c === waitIndex ? <span className={styles.wait}>?</span> : null}
            </td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
