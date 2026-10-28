import type { GameSeat } from '@shared/types';

/** Where an opponent's seat sits around the board. */
export type BoardSeatPlace = 'top' | 'left' | 'right';

/**
 * Opponents placed by their turn order after the viewer: the seat halfway round sits on top, earlier seats on
 * the left and later seats on the right, so a two-player opponent is always on top. Games whose seats belong
 * to fixed board corners (Chinese checkers with 2–4 players) pass their own places instead.
 */
export function boardSeatPlaces(seats: readonly GameSeat[], bottomSeat: GameSeat): Partial<Record<GameSeat, BoardSeatPlace>> {
  const start = Math.max(0, seats.indexOf(bottomSeat));
  const places: Partial<Record<GameSeat, BoardSeatPlace>> = {};
  for (let step = 1; step < seats.length; step++) {
    const seat = seats[(start + step) % seats.length];
    const turn = (step * 2) / seats.length;
    places[seat] = Math.abs(turn - 1) < 1e-9 || seats.length === 2 ? 'top' : turn < 1 ? 'left' : 'right';
  }
  return places;
}
