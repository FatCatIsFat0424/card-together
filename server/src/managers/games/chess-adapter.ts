import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as chess from './chess-game';

export const chessAdapter: GameAdapter<'chess'> = {
  gameType: 'chess',
  getGameState: chess.getGameState,
  exportGames: chess.exportGames,
  restoreGames: chess.restoreGames,
  abortGame: chess.abortGame,
  start: ({ roomCode, players }) => {
    chess.startGame(roomCode, players);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => isMatchControl(action)
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    ? chess.control(code, seat, action)
    : context.timed(() => chess.move(code, seat, action.from, action.to, action.promotion)),
  getPlayerVisibleState: chess.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
