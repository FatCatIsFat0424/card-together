import { gameDefinition } from '@shared/games/registry';
import { isCompassSeat } from '@shared/rules/seats';
// ─── Pure table-view helpers (no React) ───

import type { BidSuit, MatchResult, PlayerVisibleGameState, PlayingState, GameSeat } from '@shared/types';

export const AUCTION_COLUMNS: readonly GameSeat[] = ['W', 'N', 'E', 'S'];

/** A Bridge (levels 1–7) or Napoleon (levels 9–16) call. */
export interface AuctionCall {
  readonly seat: GameSeat;
  readonly action: { readonly type: 'bid'; readonly level: number; readonly suit: BidSuit } | { readonly type: 'pass' };
}

/** Place calls under their actual seat, preserving chronological row order. */
export function auctionRows<T extends AuctionCall>(
  calls: readonly T[], columns: readonly GameSeat[] = AUCTION_COLUMNS,
): (T | null)[][] {
  const rows: (T | null)[][] = [];
  let previousColumn = -1;
  for (const call of calls) {
    const column = columns.indexOf(call.seat);
    if (rows.length === 0 || column <= previousColumn) rows.push(columns.map(() => null));
    rows[rows.length - 1][column] = call;
    previousColumn = column;
  }
  return rows;
}

/** Index of the seat's most recent call in the auction, or -1 before it has called. */
export function latestCallIndex(calls: readonly AuctionCall[], seat: GameSeat): number {
  for (let index = calls.length - 1; index >= 0; index--) if (calls[index].seat === seat) return index;
  return -1;
}

/** Locate the next bidder after the last call, including an empty auction. */
export function auctionWaitIndex(
  calls: readonly AuctionCall[], toAct: GameSeat | null, columns: readonly GameSeat[] = AUCTION_COLUMNS,
): number {
  if (!toAct) return -1;
  const column = columns.indexOf(toAct);
  if (calls.length === 0) return column;
  const row = auctionRows(calls, columns).length - 1;
  const lastColumn = columns.indexOf(calls[calls.length - 1].seat);
  return (row + (column <= lastColumn ? 1 : 0)) * columns.length + column;
}

export type TablePosition = 'bottom' | 'left' | 'top' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
const CLOCKWISE: readonly GameSeat[] = ['N', 'E', 'S', 'W'];
const POSITIONS: readonly TablePosition[] = ['bottom', 'left', 'top', 'right'];

/** Seats taking part in the shown match; flexible games may leave seats empty or add P5–P8. */
export function matchSeats(game: PlayerVisibleGameState | null): readonly GameSeat[] {
  return game && gameDefinition(game.gameType).seats.flexible && 'seats' in game ? game.seats ?? CLOCKWISE : CLOCKWISE;
}

/** Seats a finished match recorded, in the order of its account ids; legacy results had all four. */
export function resultSeats(result: MatchResult): readonly GameSeat[] {
  return gameDefinition(result.gameType).seats.flexible && 'seats' in result && result.seats ? result.seats : CLOCKWISE;
}

/** How the occupied seats are arranged: the layout follows the player count, not the compass letters. */
export type SeatLayout = 'facing' | 'trio' | 'compass' | 'ring';

const RING_SLOTS: readonly TablePosition[] = ['bottom', 'bottomLeft', 'left', 'topLeft', 'top', 'topRight', 'right', 'bottomRight'];

/** Two players face each other, three sit bottom / upper-left / upper-right, four compass seats keep the cross, the rest ring the table. */
export function seatLayout(seats: readonly GameSeat[] = CLOCKWISE): SeatLayout {
  if (seats.length === 2) return 'facing';
  if (seats.length === 3) return 'trio';
  return seats.length <= 4 && seats.every(isCompassSeat) ? 'compass' : 'ring';
}

/** Whether seats can take the corner slots, so a table needs its eight-slot grid rather than the compass cross. */
export function usesCornerSlots(seats: readonly GameSeat[]): boolean {
  const layout = seatLayout(seats);
  return layout === 'ring' || layout === 'trio';
}

/** Screen position of a seat when `bottomSeat` (me) sits at the bottom of the table. */
export function tablePosition(seat: GameSeat, bottomSeat: GameSeat, seats: readonly GameSeat[] = CLOCKWISE): TablePosition {
  const layout = seatLayout(seats);
  if (layout === 'compass') return POSITIONS[(CLOCKWISE.indexOf(seat) - CLOCKWISE.indexOf(bottomSeat) + 4) % 4];
  const relative = (seats.indexOf(seat) - seats.indexOf(bottomSeat) + seats.length) % seats.length;
  return RING_SLOTS[Math.round(relative * 8 / seats.length) % 8];
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
