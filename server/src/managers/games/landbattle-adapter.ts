import { isMatchControl } from '@shared/rules/board/match-controls';
import { lbDeploySeconds } from '@shared/rules/landbattle';
import type { GameAdapter } from './game-adapter';
import * as landbattle from './landbattle-game';

export const landBattleAdapter: GameAdapter<'landbattle'> = {
  gameType: 'landbattle',
  getGameState: landbattle.getGameState,
  exportGames: landbattle.exportGames,
  restoreGames: landbattle.restoreGames,
  abortGame: landbattle.abortGame,
  start: ({ roomCode, players, settings }) => {
    landbattle.startGame(roomCode, players, lbDeploySeconds(settings.baseSeconds, settings.bankSeconds) * 1000);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    if (isMatchControl(action)) return landbattle.control(code, seat, action);
    if (action.type === 'deploy') {
      return context.simultaneous(() => {
        const result = landbattle.deploy(code, seat, action.layout, context.automatic);
        // The last deployment starts play, so the first mover's clock starts with full reserves.
        if (result.success && landbattle.getGameState(code)?.phase === 'playing') context.resetClock();
        return result;
      });
    }
    return context.timed(() => landbattle.move(code, seat, action.from, action.to));
  },
  getPlayerVisibleState: landbattle.getPlayerVisibleState,
  // Only unseated spectators reach this (two-player matches have no eliminated seats): they see every identity.
  withObserverView: landbattle.withObserverView,
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // Both seats deploy against one durable deadline; a missing deployment is made automatically.
  sharedDeadline: {
    window: (game) => (game.phase === 'deploying' ? { key: `${game.id}:deploy`, deadline: game.deployDeadline } : null),
    pendingSeats: landbattle.pendingSeats,
    owingSeats: (game) => (game.phase === 'deploying' ? landbattle.pendingSeats(game) : null),
  },
  matchResult: (game) => game.result,
};
