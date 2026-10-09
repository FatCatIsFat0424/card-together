import type { GameClock, Seat } from '@shared/types';

type LogEntry = { readonly seat?: Seat; readonly timestamp: number };

/** Timestamp of the seat's latest logged action, or 0 when it has not acted. */
export function latestSeatAction(log: readonly LogEntry[], seat: Seat): number {
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index].seat === seat) return log[index].timestamp;
  }
  return 0;
}

/**
 * The timeout badge stays until the seat's next turn begins or it acts again; the clock keeps
 * `lastTimeout` across turns, so later turns and actions are what clear it.
 */
export function showsAutoPlayed(
  clock: Pick<GameClock, 'lastTimeout' | 'turn'> | undefined, seat: Seat, lastActionAt: number,
): boolean {
  const timeout = clock?.lastTimeout;
  if (!timeout || timeout.seat !== seat) return false;
  if (clock.turn?.seat === seat && clock.turn.startsAt > timeout.at) return false;
  return lastActionAt <= timeout.at;
}

export type SeatStatus = 'busted' | 'locked' | 'thinking' | 'autoPlayed';

/** Lasting states outrank the current turn, which outranks a past timeout. */
const STATUS_PRIORITY: readonly SeatStatus[] = ['busted', 'locked', 'thinking', 'autoPlayed'];

/** The single status a seat plate shows when several apply at once. */
export function seatStatus(flags: Readonly<Record<SeatStatus, boolean>>): SeatStatus | null {
  return STATUS_PRIORITY.find((status) => flags[status]) ?? null;
}
