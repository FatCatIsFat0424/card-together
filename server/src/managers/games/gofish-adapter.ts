import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as gofish from './gofish-game';

export const goFishAdapter: GameAdapter<'gofish'> = {
  gameType: 'gofish',
  getGameState: gofish.getGameState,
  exportGames: gofish.exportGames,
  restoreGames: gofish.restoreGames,
  abortGame: gofish.abortGame,
  start: ({ roomCode, players }) => {
    gofish.startGame(roomCode, players);
    return { success: true };
  },
  // The match opens by dealing the first hand.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() =>
    gofish.ask(code, seat, action.target, action.rank))),
  getPlayerVisibleState: gofish.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // A new hand refills reserves; every ask is a fresh decision.
  clockBeforeAction: (game) => {
    const hands = game.hands;
    return (after) => ({ redealt: after.hands !== hands });
  },
  matchResult: (game) => game.result,
};
