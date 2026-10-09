// ─── AuctionTable: auction grid (W N E S) ───

import type { ReactNode } from 'react';
import type { BidLevel, BidSuit, Seat } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { AUCTION_COLUMNS, auctionRows, auctionWaitIndex } from '../game-view';
import type { AuctionCall } from '../game-view';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AuctionTable.module.css';

export function BidLabel({ level, suit }: { level: BidLevel; suit: BidSuit }): ReactNode {
  if (suit === 'nt') return <>{level}NT</>;
  const red = suit === 'hearts' || suit === 'diamonds';
  return <>{level}<span className={red ? styles.suitRed : undefined}>{SUIT_SYMBOLS[suit]}</span></>;
}

interface AuctionTableProps {
  calls: readonly AuctionCall[];
  toAct: Seat | null;
  mySeat: Seat | null;
}

export function AuctionTable({ calls, toAct, mySeat }: AuctionTableProps): ReactNode {
  const { t } = useI18nStore();
  const rows = auctionRows(calls);
  const waitIndex = auctionWaitIndex(calls, toAct);
  if (waitIndex >= rows.length * 4) rows.push([null, null, null, null]);

  return (
    <table className={styles.table}>
      <thead>
        <tr>{AUCTION_COLUMNS.map((seat) => (
          <th key={seat} className={seat === mySeat ? styles.me : undefined}>{t(`seat.${seat}`)}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>{row.map((call, c) => (
            <td key={c} className={call?.action.type === 'pass' ? styles.pass : undefined}>
              {call ? (call.action.type === 'pass' ? t('game.pass')
                : <BidLabel level={call.action.level} suit={call.action.suit} />)
                : r * 4 + c === waitIndex ? <span className={styles.wait}>?</span> : null}
            </td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
