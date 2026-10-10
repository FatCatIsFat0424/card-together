// ─── God view: spectators and eliminated players (no React) ───

import type { ObserverRole, Seat } from '@shared/types';

interface TurnView {
  readonly currentTurnSeat: Seat;
  readonly mySeat: Seat;
  readonly observer?: ObserverRole;
}

/** Spectators watch from South's side of the table but never act for that seat. */
export function isOwnTurn(game: TurnView): boolean {
  return game.observer !== 'spectator' && game.currentTurnSeat === game.mySeat;
}

/** The recipient watches without a seat of their own in the match. */
export function isSpectator(game: { readonly observer?: ObserverRole } | null | undefined): boolean {
  return game?.observer === 'spectator';
}
