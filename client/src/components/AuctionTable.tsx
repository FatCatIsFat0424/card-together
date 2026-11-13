// ─── AuctionTable: bid labels and the auction rows of the game record ───

import type { ReactNode } from 'react';
import type { BidSuit, GameSeat } from '@shared/types';
import { SUIT_SYMBOLS } from '@shared/constants';
import { auctionRows, auctionWaitIndex } from '../game-view';
import type { AuctionCall } from '../game-view';
import { useI18nStore } from '../stores/i18n-store';
import styles from './AuctionTable.module.css';

export function BidLabel({ level, suit }: { level: number; suit: BidSuit }): ReactNode {
  if (suit === 'nt') return <>{level}NT</>;
  const red = suit === 'hearts' || suit === 'diamonds';
  return <>{level}<span className={red ? styles.suitRed : undefined}>{SUIT_SYMBOLS[suit]}</span></>;
}

/** The calls as table rows under the record's seat columns, the first headed by the auction marker if `marked`. */
export function AuctionRows({ calls, toAct, columns, marked }: {
  calls: readonly AuctionCall[];
  toAct: GameSeat | null;
  columns: readonly GameSeat[];
  /** False below the record's auction toggle, which already names the section */
  marked: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  const rows = auctionRows(calls, columns);
  const waitIndex = auctionWaitIndex(calls, toAct, columns);
  if (waitIndex >= rows.length * columns.length) rows.push(columns.map(() => null));

  return rows.map((row, r) => (
    <tr key={r} className={`${styles.calls} ${columns.length > 5 ? styles.dense : ''}`}>
      <th scope="row">{marked && r === 0 && <abbr title={t('table.auction')}>{t('table.auctionShort')}</abbr>}</th>
      {row.map((call, c) => (
        <td key={c} className={call?.action.type === 'pass' ? styles.pass : undefined}>
          {/* A one-letter pass keeps six columns readable in the narrow info rail. */}
          {call ? (call.action.type === 'pass' ? <abbr title={t('game.pass')}>{t('game.passShort')}</abbr>
            : <BidLabel level={call.action.level} suit={call.action.suit} />)
            : r * columns.length + c === waitIndex ? <span className={styles.wait}>?</span> : null}
        </td>
      ))}
    </tr>
  ));
}
