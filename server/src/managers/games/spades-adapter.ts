import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as spades from './spades-game';

export const spadesAdapter: GameAdapter<'spades'> = {
  gameType: 'spades', getGameState: spades.getGameState, exportGames: spades.exportGames,
  restoreGames: spades.restoreGames, abortGame: spades.abortGame,
  start: ({ roomCode, players }) => { spades.startGame(roomCode, players); return { success: true }; },
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() => spades.act(code, seat, action))),
  getPlayerVisibleState: spades.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.position.currentTurnSeat,
  clockBeforeAction: (game) => {
    const hands = game.handResults.length;
    return (after) => ({ redealt: after.handResults.length !== hands && after.phase !== 'scoring' });
  },
  matchResult: (game) => game.result,
};
