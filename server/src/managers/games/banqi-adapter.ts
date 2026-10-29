import { isMatchControl } from '@shared/rules/board/match-controls';
import type { GameAdapter } from './game-adapter';
import * as banqi from './banqi-game';

export const banqiAdapter: GameAdapter<'banqi'> = {
  gameType: 'banqi',
  getGameState: banqi.getGameState,
  exportGames: banqi.exportGames,
  restoreGames: banqi.restoreGames,
  abortGame: banqi.abortGame,
  start: ({ roomCode, players, options }) => {
    banqi.startGame(roomCode, players, options.banqi);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    // Resigning and draw offers belong to no turn, so neither the clock nor a presentation applies.
    if (isMatchControl(action)) return banqi.control(code, seat, action);
    return context.timed(() => {
      switch (action.type) {
        case 'flip': return banqi.flip(code, seat, action.to);
        case 'move': return banqi.move(code, seat, action.from, action.to);
        case 'stop': return banqi.stop(code, seat);
      }
    });
  },
  getPlayerVisibleState: banqi.getPlayerVisibleState,
  // Only an unseated spectator is told what lies under the face-down pieces.
  withObserverView: (visible, game, observer) => (observer === 'spectator'
    ? { ...visible, observer, observedPieces: banqi.hiddenPieces(game) } : { ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // A chain keeps the same seat deciding, so its unused base time carries over.
  clockBeforeAction: (_game, seat) => (after) => ({ sameTurn: after.phase === 'playing' && after.currentTurnSeat === seat }),
  matchResult: (game) => game.result,
};
