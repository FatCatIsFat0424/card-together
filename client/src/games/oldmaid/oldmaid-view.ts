import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { gameSeatMap } from '@shared/rules/seats';
import type { GameSeat, OldMaidLogEntry, OldMaidVisibleState } from '@shared/types';
import { createLogViewCache } from '../log-view-cache';

/** Public table state as of one point in the log. */
export interface OldMaidTableView {
  readonly deal: number;
  /** Cards each seat holds */
  readonly counts: Record<GameSeat, number>;
  /** Seats out of cards in this deal, in finishing order */
  readonly finished: readonly GameSeat[];
  /** Pairs each seat has put on the discard pile in this deal */
  readonly pairs: Record<GameSeat, number>;
  readonly totals: Record<GameSeat, number>;
  /** The latest draw, for the position it took */
  readonly lastDraw: { readonly seat: GameSeat; readonly from: GameSeat; readonly index: number } | null;
  /** The local hand was dealt by a deal the presentation has not reached yet */
  readonly handHidden: boolean;
  /** Log entries already shown */
  readonly logEnd: number;
}

/** What the local player's controls do right now. */
export type OldMaidMode = 'draw' | 'wait';

/** Replays the public log before `end`. */
export function replayOldMaid(
  log: readonly OldMaidLogEntry[], end: number,
): Omit<OldMaidTableView, 'handHidden' | 'logEnd'> {
  let deal = 1;
  let counts = gameSeatMap(() => 0);
  let finished: GameSeat[] = [];
  let pairs = gameSeatMap(() => 0);
  let totals = gameSeatMap(() => 0);
  let lastDraw: OldMaidTableView['lastDraw'] = null;
  for (const entry of log.slice(0, end)) {
    if (entry.type === 'deal') {
      deal = entry.deal;
      counts = { ...entry.counts };
      finished = [...entry.finished];
      pairs = gameSeatMap((seat) => entry.discards[seat].length / 2);
      lastDraw = null;
    } else if (entry.type === 'draw') {
      counts = { ...counts, [entry.from]: counts[entry.from] - 1,
        [entry.seat]: counts[entry.seat] + 1 - entry.discarded.length };
      finished = [...finished, ...entry.finished];
      pairs = { ...pairs, [entry.seat]: pairs[entry.seat] + entry.discarded.length / 2 };
      lastDraw = { seat: entry.seat, from: entry.from, index: entry.index };
    } else {
      totals = { ...entry.totals };
    }
  }
  return { deal, counts, finished, pairs, totals, lastDraw };
}

const views = createLogViewCache<OldMaidVisibleState, OldMaidTableView>();

/**
 * The table as the presentation currently shows it: a draw and a settlement stay unresolved until their frame,
 * and the next deal's hand stays hidden until its deal frame.
 */
export function oldMaidView(game: OldMaidVisibleState, frame: PresentationFrame | null): OldMaidTableView {
  const index = frame ? frameLogIndex(frame) : null;
  if (index === null) {
    return views.get(game, game.log.length, () => ({
      ...replayOldMaid(game.log, game.log.length), handHidden: false, logEnd: game.log.length,
    }));
  }
  const end = index + 1;
  return views.get(game, end, () => ({
    ...replayOldMaid(game.log, end),
    handHidden: game.log.slice(end).some((entry) => entry.type === 'deal'),
    logEnd: end,
  }));
}

export function oldMaidMode(game: OldMaidVisibleState, isMyTurn: boolean): OldMaidMode {
  return isMyTurn && game.phase === 'playing' && game.drawFrom !== null && game.handCounts[game.drawFrom] > 0
    ? 'draw' : 'wait';
}

/** Newest first, limited to `limit` entries. */
export function recentOldMaidMoves(log: readonly OldMaidLogEntry[], limit: number): OldMaidLogEntry[] {
  return limit > 0 ? log.slice(-limit).reverse() : [];
}

/** The seat's place in this deal: 1 for the first one out, or null while it still holds cards. */
export function finishPlace(view: Pick<OldMaidTableView, 'finished'>, seat: GameSeat): number | null {
  const index = view.finished.indexOf(seat);
  return index >= 0 ? index + 1 : null;
}

/** Whether the seat is out of cards for the rest of this deal. */
export function seatOut(view: Pick<OldMaidTableView, 'finished'>, seat: GameSeat): boolean {
  return view.finished.includes(seat);
}

/** A fan wider than this wraps into two rows so every position stays tappable. */
const ROW_LIMIT = 9;

/** Splits positions 0..count-1 into at most two rows of nearly equal length. */
export function fanRows(count: number): number[][] {
  const positions = Array.from({ length: count }, (_, index) => index);
  if (count <= ROW_LIMIT) return [positions];
  const half = Math.ceil(count / 2);
  return [positions.slice(0, half), positions.slice(half)];
}
