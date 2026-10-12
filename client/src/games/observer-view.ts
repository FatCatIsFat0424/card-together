// ─── God view: spectators and eliminated players (no React) ───

import type { ObserverRole, GameSeat } from '@shared/types';

interface TurnView {
  readonly currentTurnSeat: GameSeat;
  readonly mySeat: GameSeat;
  readonly observer?: ObserverRole;
}

/** A viewing perspective never grants a spectator permission to act for that seat. */
export function isOwnTurn(game: TurnView): boolean {
  return game.observer !== 'spectator' && game.currentTurnSeat === game.mySeat;
}

/** The recipient watches without a seat of their own in the match. */
export function isSpectator(game: { readonly observer?: ObserverRole } | null | undefined): boolean {
  return game?.observer === 'spectator';
}
