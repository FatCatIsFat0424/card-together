import type { GameClock, Seat } from '@shared/types';

export interface SeatClock {
  readonly active: boolean;
  readonly paused: boolean;
  readonly expired: boolean;
  readonly baseMs: number;
  readonly bankMs: number;
}

/** Project a committed server clock locally; duplicate snapshots retain their receipt time. */
export function seatClock(clock: GameClock, seat: Seat, receivedAt: number, now: number): SeatClock {
  const serverNow = clock.serverNow === undefined ? now : clock.serverNow + Math.max(0, now - receivedAt);
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
