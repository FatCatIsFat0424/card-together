import { GAME_SEAT_ORDER } from '@shared/constants';
import { frameLogIndex } from '@shared/game-presentation';
import type { PresentationFrame } from '@shared/game-presentation';
import { studHand, studReplay } from '@shared/rules/stud';
import type { StudTableView } from '@shared/rules/stud';
import type { Card, ChinesePokerCategory, StudLogEntry, StudVisibleState, GameSeat } from '@shared/types';
import { createLogViewCache } from '../log-view-cache';
import type { BettingTableView, HoldemAwardView } from '../holdem/holdem-view';

/** Public table as the presentation currently shows it. */
export interface StudShownTable extends StudTableView, BettingTableView {
  /** Log entries already shown */
  readonly logEnd: number;
}

function seatMap<T>(value: (seat: GameSeat) => T): Record<GameSeat, T> {
  return Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, value(seat)])) as Record<GameSeat, T>;
}

/** Index of the latest `hand` entry before `end`, or -1 before the first deal. */
function handStart(log: readonly StudLogEntry[], end: number): number {
  for (let index = Math.min(end, log.length) - 1; index >= 0; index--) {
    if (log[index].type === 'hand') return index;
  }
  return -1;
}

const tables = createLogViewCache<readonly StudLogEntry[], StudTableView>();
const awards = createLogViewCache<readonly StudLogEntry[], HoldemAwardView | null>();
const replays = createLogViewCache<readonly StudLogEntry[], StudShownTable>();
const views = createLogViewCache<StudVisibleState, StudShownTable>();

const replayKey = (seats: readonly GameSeat[], end: number): string => `${seats.join('')}:${end}`;

/** The public table after the first `end` entries; shared between callers, so treat it as read-only. */
export function studTableAt(log: readonly StudLogEntry[], seats: readonly GameSeat[], end: number): StudTableView {
  return tables.get(log, replayKey(seats, end), () => studReplay(log, seats, end));
}

/** The award of the hand shown after the first `end` entries, if it has been reached. */
export function studShownAward(log: readonly StudLogEntry[], seats: readonly GameSeat[], end: number): HoldemAwardView | null {
  const stop = Math.min(end, log.length);
  return awards.get(log, replayKey(seats, stop), () => {
    const start = handStart(log, stop);
    for (let index = stop - 1; index > start; index--) {
      const entry = log[index];
      if (entry.type !== 'award') continue;
      const before = studTableAt(log, seats, index).chips;
      return {
        pots: entry.pots,
        payouts: seatMap((seat) => Math.max(0, entry.chips[seat] - before[seat])),
        eliminated: entry.eliminated,
      };
    }
    return null;
  });
}

/** The table of a match between `seats` rebuilt from the public log before `end`. */
export function replayStud(log: readonly StudLogEntry[], seats: readonly GameSeat[], end: number): StudShownTable {
  return replays.get(log, replayKey(seats, end), () => ({
    ...studTableAt(log, seats, end), award: studShownAward(log, seats, end), logEnd: Math.min(end, log.length),
  }));
}

/**
 * While a frame is presented the table is rebuilt up to that frame's entry, so up cards, bets,
 * showdown cards, and awards never appear before their own frames.
 */
export function studView(game: StudVisibleState, frame: PresentationFrame | null): StudShownTable {
  const index = frame ? frameLogIndex(frame) : null;
  if (index !== null) return replayStud(game.log, game.seats, index + 1);
  return views.get(game, 'live', () => ({
    ...game, award: studShownAward(game.log, game.seats, game.log.length), logEnd: game.log.length,
  }));
}

/** Category of the five cards once the seat's hole card is known and all four up cards are out. */
export function studCategory(hole: readonly Card[], up: readonly Card[]): ChinesePokerCategory | null {
  return hole.length === 1 && up.length === 4 ? studHand(hole, up).category : null;
}

/** Chips an action at `index` added to the seat's stake on its street. */
export function studChipsAdded(log: readonly StudLogEntry[], index: number): number {
  const entry = log[index];
  if (entry?.type !== 'action') return 0;
  for (let previous = index - 1; previous >= 0; previous--) {
    const earlier = log[previous];
    if (earlier.type === 'street' || earlier.type === 'hand') return entry.to;
    if (earlier.type === 'action' && earlier.seat === entry.seat && earlier.action !== 'fold') return entry.to - earlier.to;
  }
  return entry.to;
}

/** Newest first, limited to `limit` entries of the shown log. */
export function recentStudMoves(log: readonly StudLogEntry[], end: number, limit: number): StudLogEntry[] {
  return limit > 0 ? log.slice(0, end).slice(-limit).reverse() : [];
}

/** Every chip staked this hand, antes included. */
export function studAnteTotal(entry: Extract<StudLogEntry, { type: 'hand' }>): number {
  return GAME_SEAT_ORDER.reduce((sum, seat) => sum + entry.antes[seat], 0);
}
