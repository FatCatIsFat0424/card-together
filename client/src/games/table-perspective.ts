import type { PlayerVisibleGameState, GameSeat } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { matchSeats } from '../game-view';
import type { GodView } from '../stores/god-view-store';
import { isSpectator } from './observer-view';
import { clientGame } from './registry';

/**
 * Spectators watch from the seat they picked. Until they pick one, card tables keep South at the bottom
 * and board games show the first player's side.
 */
export function perspectiveSeat(
  game: PlayerVisibleGameState | null, selected: GameSeat, own: GameSeat | null, chosen = true,
): GameSeat {
  if (!game || !isSpectator(game)) return own ?? 'S';
  const seats = matchSeats(game);
  if (!chosen && gameDefinition(game.gameType).category === 'board') return seats[0] ?? 'S';
  return seats.includes(selected) ? selected : seats[0] ?? 'S';
}

/** Project only display fields; the authoritative snapshot and observer permissions stay intact. */
export function spectatorGame<T extends PlayerVisibleGameState>(game: T, seat: GameSeat, view: GodView): T {
  if (!isSpectator(game)) return game;
  return { ...game, mySeat: seat, ...clientGame(game.gameType).spectatorPatch(view, seat) };
}
