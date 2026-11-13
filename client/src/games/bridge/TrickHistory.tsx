// ─── TrickHistory: Bridge's completed tricks (after the auction, if given) with the declarer marked ───

import type { ReactNode } from 'react';
import { RANK_DISPLAY, SUIT_SYMBOLS } from '@shared/constants';
import { isJoker } from '@shared/rules/cards';
import type { Seat, TrickRecord } from '@shared/types';
import { viewerFirstSeats } from '../../game-view';
import { useI18nStore } from '../../stores/i18n-store';
import { TrickHistoryTable } from '../TrickHistoryTable';
import type { TrickHistoryAuction, TrickHistoryRow } from '../TrickHistoryTable';

const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

/** Columns shared by the trick history and the auction. */
export function bridgeSeatColumns(mySeat: Seat | null): Seat[] {
  return viewerFirstSeats(SEATS, mySeat) as Seat[];
}

export function bridgeTrickRows(tricks: readonly TrickRecord[]): TrickHistoryRow[] {
  return tricks.map((trick, index) => ({ number: index + 1, leadSeat: trick.leadSeat, cards: trick.cards,
    winnerSeat: trick.winnerSeat }));
}

export function TrickHistory({ tricks, mySeat, declarer, auction, className, summaryClassName, defaultOpen, bare }: {
  tricks: readonly TrickRecord[];
  mySeat: Seat | null;
  declarer: Seat | null;
  auction?: TrickHistoryAuction;
  className?: string;
  summaryClassName?: string;
  defaultOpen?: boolean;
  bare?: boolean;
}): ReactNode {
  const { t } = useI18nStore();
  return <TrickHistoryTable rows={bridgeTrickRows(tricks)} columns={bridgeSeatColumns(mySeat)} mySeat={mySeat}
    roles={declarer ? [{ seat: declarer, label: t('table.declarer'),
      color: 'var(--badge-declarer)', ink: 'var(--text-inverse)' }] : []}
    cardText={(card) => isJoker(card) ? '' : `${SUIT_SYMBOLS[card.suit]}${RANK_DISPLAY[card.rank]}`}
    auction={auction} className={className} summaryClassName={summaryClassName} defaultOpen={defaultOpen} bare={bare} />;
}
