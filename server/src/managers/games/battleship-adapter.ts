import { isMatchControl } from '@shared/rules/board/match-controls';
import { DEFAULT_BATTLESHIP_OPTIONS, bsPlaceSeconds } from '@shared/rules/battleship';
import type { GameAdapter } from './game-adapter';
import * as battleship from './battleship-game';

export const battleshipAdapter: GameAdapter<'battleship'> = {
  gameType: 'battleship',
  getGameState: battleship.getGameState,
  exportGames: battleship.exportGames,
  restoreGames: battleship.restoreGames,
  abortGame: battleship.abortGame,
  start: ({ roomCode, players, settings, options }) => {
    battleship.startGame(roomCode, players, options.battleship ?? DEFAULT_BATTLESHIP_OPTIONS,
      bsPlaceSeconds(settings.baseSeconds, settings.bankSeconds) * 1000);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    // Resigning belongs to no turn, so neither the clock nor a presentation applies.
    if (isMatchControl(action)) return battleship.control(code, seat, action);
    if (action.type === 'place-fleet') {
      return context.simultaneous(() => {
        const result = battleship.placeFleet(code, seat, action.fleet, context.automatic);
        // The last fleet starts play, so the first shooter's clock starts with full reserves.
        if (result.success && battleship.getGameState(code)?.phase === 'playing') context.resetClock();
        return result;
      });
    }
    return context.timed(() => battleship.fire(code, seat, action.to));
  },
  getPlayerVisibleState: battleship.getPlayerVisibleState,
  // Only unseated spectators reach this (two-player matches have no eliminated seats): they see both fleets.
  withObserverView: battleship.withObserverView,
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // Both seats place their fleets against one durable deadline; a missing fleet is placed automatically.
  sharedDeadline: {
    window: (game) => (game.phase === 'placing' ? { key: `${game.id}:place`, deadline: game.placeDeadline } : null),
    pendingSeats: battleship.pendingSeats,
    owingSeats: (game) => (game.phase === 'placing' ? battleship.pendingSeats(game) : null),
  },
  matchResult: (game) => game.result,
};
