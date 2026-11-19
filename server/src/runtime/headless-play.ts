import type { AnyGameState, GameSeat } from '@shared/types';
import { getTurnSeat } from '../managers/game-clock';
import * as gameManager from '../managers/game-manager';

// Helpers for driving a match without timers or sockets: recorded test matches and offline bot matches.
// Live tables use the bot and timeout schedulers instead, which wait for presentations and deadlines.

/**
 * The seat whose decision the game waits for next: the first seat, in seat order, that still owes a
 * simultaneous decision (Hearts passes, bets, arrangements, deployments), otherwise the turn holder.
 * Null once the match is over.
 */
export function pendingActionSeat(game: AnyGameState): GameSeat | null {
  const owing = gameManager.getOwingSeats(game);
  return owing ? owing[0] ?? null : getTurnSeat(game);
}

/**
 * Drops the presentation of the previous action, which only paces live tables, so the next action applies
 * at once. A pending Big Two forced pass (`gameManager.isForcedActionPending`) still has to be applied by
 * the caller: it is an ordinary pass by the turn holder.
 */
export function skipPresentation(game: AnyGameState): void {
  delete game.presentation;
}
