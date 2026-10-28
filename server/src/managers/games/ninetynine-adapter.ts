import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as ninetynine from './ninetynine-game';

export const ninetyNineAdapter: GameAdapter<'ninetynine'> = {
  gameType: 'ninetynine',
  getGameState: ninetynine.getGameState,
  exportGames: ninetynine.exportGames,
  restoreGames: ninetynine.restoreGames,
  abortGame: ninetynine.abortGame,
  start: ({ roomCode, players, options }) => {
    ninetynine.startGame(roomCode, players, undefined, undefined, options.ninetynine);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() =>
    ninetynine.play(code, seat, action.card, action.choice, action.target))),
  getPlayerVisibleState: ninetynine.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  eliminationIndex: (game, seat) => game.log.findIndex((entry) => entry.type === 'eliminated' && entry.seat === seat),
  turnSeat: (game) => game.currentTurnSeat,
  matchResult: (game) => game.result,
};
