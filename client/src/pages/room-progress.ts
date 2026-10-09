import type { SeatMap } from '@shared/types';

export interface RoomProgress {
  readonly seated: number;
  readonly ready: number;
}

/** Occupied and ready seats; bots are always ready. */
export function roomProgress(seats: SeatMap): RoomProgress {
  const occupied = Object.values(seats).filter((seat) => seat.player !== null);
  return {
    seated: occupied.length,
    ready: occupied.filter((seat) => seat.isReady || seat.player?.isBot).length,
  };
}

/** Messages that arrived while the chat panel was hidden. */
export function unreadCount(total: number, seen: number, open: boolean): number {
  return open ? 0 : Math.max(0, total - seen);
}
