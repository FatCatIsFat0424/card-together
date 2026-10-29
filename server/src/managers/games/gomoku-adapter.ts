import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as gomoku from './gomoku-game';

export const gomokuAdapter: GameAdapter<'gomoku'> = {
  gameType: 'gomoku',
  getGameState: gomoku.getGameState,
  exportGames: gomoku.exportGames,
  restoreGames: gomoku.restoreGames,
  abortGame: gomoku.abortGame,
  start: ({ roomCode, players, options }) => {
    gomoku.startGame(roomCode, players, options.gomoku);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    if (isMatchControl(action)) return gomoku.control(code, seat, action);
    return context.timed(() => action.type === 'place'
      ? gomoku.place(code, seat, action.to)
      : gomoku.chooseSide(code, seat, action.swap));
  },
  getPlayerVisibleState: gomoku.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
