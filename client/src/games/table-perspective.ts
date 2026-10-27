import type { PlayerVisibleGameState, GameSeat } from '@shared/types';
import { matchSeats } from '../game-view';
import type { GodView } from '../stores/god-view-store';
import { isSpectator } from './observer-view';
import { clientGame } from './registry';

export function perspectiveSeat(game: PlayerVisibleGameState | null, selected: GameSeat, own: GameSeat | null): GameSeat {
  if (!isSpectator(game)) return own ?? 'S';
  const seats = matchSeats(game);
  return seats.includes(selected) ? selected : seats[0] ?? 'S';
}

/** Project only display fields; the authoritative snapshot and observer permissions stay intact. */
export function spectatorGame<T extends PlayerVisibleGameState>(game: T, seat: GameSeat, view: GodView): T {
  if (!isSpectator(game)) return game;
  return { ...game, mySeat: seat, ...clientGame(game.gameType).spectatorPatch(view, seat) };
}
