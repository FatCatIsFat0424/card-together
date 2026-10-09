import type { Seat } from '../types';
import { SEAT_ORDER_CLOCKWISE } from '../constants';

/** N → E → S → W → N. */
export function nextSeatClockwise(seat: Seat): Seat {
  return SEAT_ORDER_CLOCKWISE[(SEAT_ORDER_CLOCKWISE.indexOf(seat) + 1) % SEAT_ORDER_CLOCKWISE.length];
}

/** N → W → S → E → N. */
export function nextSeatCounterClockwise(seat: Seat): Seat {
  const index = SEAT_ORDER_CLOCKWISE.indexOf(seat);
  return SEAT_ORDER_CLOCKWISE[(index + SEAT_ORDER_CLOCKWISE.length - 1) % SEAT_ORDER_CLOCKWISE.length];
}
