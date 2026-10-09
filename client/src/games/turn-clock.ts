import type { GameClock, Seat } from '@shared/types';

export interface SeatClock {
  readonly active: boolean;
  readonly paused: boolean;
  readonly expired: boolean;
  readonly baseMs: number;
  readonly bankMs: number;
}

/** Server time projected from the snapshot's receipt; duplicate snapshots retain their receipt time. */
export function projectedServerNow(clock: Pick<GameClock, 'serverNow'>, receivedAt: number, now: number): number {
  return clock.serverNow === undefined ? now : clock.serverNow + Math.max(0, now - receivedAt);
}

/** Project a committed server clock locally. */
export function seatClock(clock: GameClock, seat: Seat, receivedAt: number, now: number): SeatClock {
  const serverNow = projectedServerNow(clock, receivedAt, now);
  const turn = clock.turn;
  const active = turn?.seat === seat;
  const elapsed = active ? Math.max(0, serverNow - turn.startsAt) : 0;
  const baseMs = active ? Math.max(0, turn.baseRemainingMs - elapsed) : 0;
  const bankMs = Math.max(0, clock.bankRemainingMs[seat]
    - (active ? Math.max(0, elapsed - turn.baseRemainingMs) : 0));
  return {
    active,
    paused: active && serverNow < turn.startsAt,
    expired: active && serverNow >= turn.deadline,
    baseMs,
    bankMs,
  };
}

/** Slack so the re-render lands just after the displayed second changes. */
const TICK_SLACK_MS = 15;

/**
 * Delay until a countdown shown as whole seconds (rounded up) changes, so redraws line up
 * with second boundaries instead of polling.
 */
export function clockTickDelay(remainingMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 1000;
  return (remainingMs % 1000 || 1000) + TICK_SLACK_MS;
}

/** The value currently counting down: the turn allowance first, then the reserve. */
export function countingMs(time: SeatClock): number {
  return time.baseMs > 0 ? time.baseMs : time.bankMs;
}
