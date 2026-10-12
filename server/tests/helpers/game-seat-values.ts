import type { GameSeat, Seat } from '@shared/types';
import { normalizeGameSeatMaps } from '@shared/game-seat-compat';

type SeatValue = number | boolean | null | readonly unknown[];
type Expanded<T> = T extends readonly unknown[] ? { -readonly [K in keyof T]: Expanded<T[K]> }
  : T extends Record<Seat, infer V> ? V extends SeatValue ? Record<GameSeat, Expanded<V>> : { [K in keyof T]: Expanded<T[K]> }
    : T extends object ? { [K in keyof T]: Expanded<T[K]> } : T;

/** Keep four-player fixtures while supplying empty values for the unused additional seats. */
export function gameSeatValues<const T>(values: T): Expanded<T> {
  return normalizeGameSeatMaps(values) as Expanded<T>;
}
