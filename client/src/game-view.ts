import { isCompassSeat } from '@shared/rules/seats';
// ─── Pure table-view helpers (no React) ───

import type { BidAction, MatchResult, PlayerVisibleGameState, PlayingState, GameSeat } from '@shared/types';

export const AUCTION_COLUMNS: readonly GameSeat[] = ['W', 'N', 'E', 'S'];

export interface AuctionCall { readonly seat: GameSeat; readonly action: BidAction }

/** Place calls under their actual seat, preserving chronological row order. */
export function auctionRows(calls: readonly AuctionCall[]): (AuctionCall | null)[][] {
  const rows: (AuctionCall | null)[][] = [];
  let previousColumn = -1;
  for (const call of calls) {
    const column = AUCTION_COLUMNS.indexOf(call.seat);
    if (rows.length === 0 || column <= previousColumn) rows.push([null, null, null, null]);
    rows[rows.length - 1][column] = call;
    previousColumn = column;
  }
  return rows;
}

/** Locate the next bidder after the last call, including an empty auction. */
export function auctionWaitIndex(calls: readonly AuctionCall[], toAct: GameSeat | null): number {
  if (!toAct) return -1;
  const column = AUCTION_COLUMNS.indexOf(toAct);
  if (calls.length === 0) return column;
  const row = auctionRows(calls).length - 1;
  const lastColumn = AUCTION_COLUMNS.indexOf(calls[calls.length - 1].seat);
  return (row + (column <= lastColumn ? 1 : 0)) * AUCTION_COLUMNS.length + column;
}

export type TablePosition = 'bottom' | 'left' | 'top' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
const CLOCKWISE: readonly GameSeat[] = ['N', 'E', 'S', 'W'];
const POSITIONS: readonly TablePosition[] = ['bottom', 'left', 'top', 'right'];

/** Seats taking part in the shown match; Blackjack and Hold'em may leave seats empty. */
export function matchSeats(game: PlayerVisibleGameState | null): readonly GameSeat[] {
  return game?.gameType === 'blackjack' || game?.gameType === 'holdem' || game?.gameType === 'ninetynine' ? game.seats ?? CLOCKWISE : CLOCKWISE;
}

/** Seats a finished match recorded, in the order of its account ids; legacy results had all four. */
export function resultSeats(result: MatchResult): readonly GameSeat[] {
  return (result.gameType === 'blackjack' || result.gameType === 'holdem' || result.gameType === 'ninetynine') && result.seats ? result.seats : CLOCKWISE;
}

/** Screen position of a seat when `bottomSeat` (me) sits at the bottom of the table. */
export function tablePosition(seat: GameSeat, bottomSeat: GameSeat, seats: readonly GameSeat[] = CLOCKWISE): TablePosition {
  if (seats.some((value) => !isCompassSeat(value)) || seats.length > 4) {
    const slots: readonly TablePosition[] = ['bottom', 'bottomLeft', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight'];
    const relative = (seats.indexOf(seat) - seats.indexOf(bottomSeat) + seats.length) % seats.length;
    return slots[Math.round(relative * 8 / seats.length) % 8];
  }
  return POSITIONS[(CLOCKWISE.indexOf(seat) - CLOCKWISE.indexOf(bottomSeat) + 4) % 4];
}

/** Remaining time as `m:ss`, rounded up to whole seconds and never negative. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Cards left in a seat's hand: 13 before play; during play 13 - completed tricks - (1 if the seat has a card in the current trick). */
export function remainingCards(seat: GameSeat, playing: PlayingState | null): number {
  if (!playing) return 13;
  if (!isCompassSeat(seat)) return 0;
  return 13 - playing.completedTricks.length - (playing.currentTrick[seat] ? 1 : 0);
}

export interface TableMove { readonly seat: GameSeat; readonly index: number; readonly pass: boolean }

type LogLike = readonly { readonly type: string; readonly seat?: GameSeat }[];

function lastOf(log: LogLike, types: readonly string[]): { seat: GameSeat; index: number; type: string } | null {
  for (let index = log.length - 1; index >= 0; index--) {
    const { type, seat } = log[index];
    if (seat && types.includes(type)) return { seat, index, type };
  }
  return null;
}

/** Latest card play (or Big Two pass / Red Points flip) in any game's log; `index` changes on every new move. */
export function lastMove(log: LogLike): TableMove | null {
  const entry = lastOf(log, ['play', 'flip', 'pass']);
  return entry && { seat: entry.seat, index: entry.index, pass: entry.type === 'pass' };
}

/** Latest elimination (99 bust) in the log. */
export function lastElimination(log: LogLike): { seat: GameSeat; index: number } | null {
  const entry = lastOf(log, ['eliminated']);
  return entry && { seat: entry.seat, index: entry.index };
}
