import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as xiangqi from './xiangqi-game';

export const xiangqiAdapter: GameAdapter<'xiangqi'> = {
  gameType: 'xiangqi',
  getGameState: xiangqi.getGameState,
  exportGames: xiangqi.exportGames,
  restoreGames: xiangqi.restoreGames,
  abortGame: xiangqi.abortGame,
  start: ({ roomCode, players, options }) => {
    xiangqi.startGame(roomCode, players, options.xiangqi);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => isMatchControl(action)
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    ? xiangqi.control(code, seat, action)
    : context.timed(() => xiangqi.move(code, seat, action.from, action.to)),
  getPlayerVisibleState: xiangqi.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  matchResult: (game) => game.result,
};
