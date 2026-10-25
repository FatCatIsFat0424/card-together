// ─── TrickHistoryTable: one row per trick, one fixed column per player ───

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { isNapoleonJoker } from '@shared/rules/napoleon';
import type { GameSeat, NapoleonCard } from '@shared/types';
import { useI18nStore } from '../stores/i18n-store';
import { CardLabel } from './CardLabel';
import { useSeatName } from './seat-names';
import styles from './TrickHistoryTable.module.css';

export interface TrickHistoryRow {
  /** One-based trick number */
  readonly number: number;
  readonly leadSeat: GameSeat;
  readonly cards: Readonly<Partial<Record<GameSeat, NapoleonCard>>>;
  /** Null while the trick is still being played */
  readonly winnerSeat: GameSeat | null;
  /** Shown under the row, such as a named suit or a summon */
  readonly note?: ReactNode;
}

/** A role marked over its seat's column and explained in the legend. */
export interface TrickHistoryRole {
  readonly seat: GameSeat;
  readonly label: string;
  /** CSS colours of the column marker and legend badge */
  readonly color: string;
  readonly ink: string;
}

/** History columns in seating order, starting from the viewer's own seat when they hold one. */
export function trickHistoryColumns(seats: readonly GameSeat[], viewer: GameSeat | null): GameSeat[] {
  const start = viewer ? Math.max(0, seats.indexOf(viewer)) : 0;
  return [...seats.slice(start), ...seats.slice(0, start)];
}

export function TrickHistoryTable({
  rows, columns, mySeat, roles = [], cardText, columnLabel, seatName, className, summaryClassName, defaultOpen = true,
}: {
  rows: readonly TrickHistoryRow[];
  columns: readonly GameSeat[];
  mySeat: GameSeat | null;
  roles?: readonly TrickHistoryRole[];
  /** Plain card name for hover titles */
  cardText: (card: NapoleonCard) => string;
  /** Column heading for a seat; the player's name by default, which stays the heading's hover title */
  columnLabel?: (seat: GameSeat) => string;
  /** Historical views resolve seats from their recorded participants instead of the live room. */
  seatName?: (seat: GameSeat) => string;
  className?: string;
  summaryClassName?: string;
  defaultOpen?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const { t } = useI18nStore();
  const liveName = useSeatName();
  const name = seatName ?? liveName;
  if (rows.length === 0) return null;
  const roleOf = (seat: GameSeat): TrickHistoryRole | undefined => roles.find((role) => role.seat === seat);

  return (
    <details className={`${styles.history} ${className ?? ''}`} open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>{t('table.trickHistory')} ({rows.length})</summary>
      {open && <>
        <table className={styles.table} style={{ '--columns': columns.length } as CSSProperties}>
          <thead>
            <tr>
              <th scope="col" className={styles.number}>#</th>
              {columns.map((seat) => <th key={seat} scope="col" title={name(seat)}
                className={seat === mySeat ? styles.mine : undefined}
                style={{ borderTopColor: roleOf(seat)?.color }}>
                <span className={styles.name}>{columnLabel ? columnLabel(seat) : name(seat)}</span>
              </th>)}
            </tr>
          </thead>
          {rows.map((row) => <tbody key={row.number} className={styles.trick}>
            <tr>
              <th scope="row" className={styles.number}>{row.number}</th>
              {columns.map((seat) => {
                const card = row.cards[seat];
                const lead = seat === row.leadSeat;
                const won = seat === row.winnerSeat;
                const title = [name(seat), card ? cardText(card) : null,
                  lead ? t('table.lead') : null, won ? t('table.winner') : null].filter(Boolean).join(' · ');
                return <td key={seat} title={title} className={`${lead ? styles.lead : ''} ${won ? styles.won : ''}`}>
                  {card ? <CardLabel card={card} className={isNapoleonJoker(card) ? styles.joker : undefined} /> : <span className={styles.empty}>·</span>}
                </td>;
              })}
            </tr>
            {row.note && <tr className={styles.note}>
              <td />
              <td colSpan={columns.length}>{row.note}</td>
            </tr>}
          </tbody>)}
        </table>
        <p className={styles.legend}>
          <span className={styles.legendLead}>{t('table.lead')}</span>
          <span className={styles.legendWon}>{t('table.winner')}</span>
          {roles.map((role) => <span key={role.seat} className={styles.badge}
            style={{ background: role.color, color: role.ink }}>{role.label}</span>)}
        </p>
      </>}
    </details>
  );
}
