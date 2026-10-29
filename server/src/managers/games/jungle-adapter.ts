import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as jungle from './jungle-game';

export const jungleAdapter: GameAdapter<'jungle'> = {
  gameType: 'jungle',
  getGameState: jungle.getGameState,
  exportGames: jungle.exportGames,
  restoreGames: jungle.restoreGames,
  abortGame: jungle.abortGame,
  start: ({ roomCode, players }) => {
    jungle.startGame(roomCode, players);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => isMatchControl(action)
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    ? jungle.control(code, seat, action)
    : context.timed(() => jungle.move(code, seat, action.from, action.to)),
  getPlayerVisibleState: jungle.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
