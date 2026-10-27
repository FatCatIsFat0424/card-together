import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as holdem from './holdem-game';

export const holdemAdapter: GameAdapter<'holdem'> = {
  gameType: 'holdem',
  getGameState: holdem.getGameState,
  exportGames: holdem.exportGames,
  restoreGames: holdem.restoreGames,
  abortGame: holdem.abortGame,
  start: ({ roomCode, players }) => {
    holdem.startGame(roomCode, players);
    return { success: true };
  },
  // The match opens by dealing the first hand.
  presentsOpening: true,
  getPlayerVisibleState: holdem.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  eliminationIndex: (game, seat) => game.log.findIndex((entry) => entry.type === 'award' && entry.eliminated.includes(seat)),
  turnSeat: (game) => game.currentTurnSeat,
  // Each hand is a new deal, which refills reserves.
  clockBeforeAction: (game) => {
    const hands = game.hands;
    return (after) => ({ redealt: after.hands !== hands });
  },
  matchResult: (game) => game.result,
};
