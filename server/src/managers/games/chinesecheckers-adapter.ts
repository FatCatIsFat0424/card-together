import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as checkers from './chinesecheckers-game';

export const chineseCheckersAdapter: GameAdapter<'chinesecheckers'> = {
  gameType: 'chinesecheckers',
  getGameState: checkers.getGameState,
  exportGames: checkers.exportGames,
  restoreGames: checkers.restoreGames,
  abortGame: checkers.abortGame,
  start: ({ roomCode, players }) => checkers.startGame(roomCode, players),
  applyAction: (code, seat, action, context) => {
    if (!isMatchControl(action)) return context.timed(() => checkers.move(code, seat, action.from, action.to));
    // Controls belong to no turn, except a multi-player resignation on turn, which hands the turn on.
    return action.type === 'resign' && checkers.resignationMovesTurn(code, seat)
      ? context.timed(() => checkers.control(code, seat, action))
      : checkers.control(code, seat, action);
  },
  getPlayerVisibleState: checkers.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  // A seat that resigned a multi-player match watches the rest of it.
  eliminationIndex: (game, seat) => game.log.findIndex((entry) => entry.resigned && entry.seat === seat),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
