import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as reversi from './reversi-game';

export const reversiAdapter: GameAdapter<'reversi'> = {
  gameType: 'reversi',
  getGameState: reversi.getGameState,
  exportGames: reversi.exportGames,
  restoreGames: reversi.restoreGames,
  abortGame: reversi.abortGame,
  start: ({ roomCode, players }) => {
    reversi.startGame(roomCode, players);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => isMatchControl(action)
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    ? reversi.control(code, seat, action)
    : context.timed(() => reversi.place(code, seat, action.to)),
  getPlayerVisibleState: reversi.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
