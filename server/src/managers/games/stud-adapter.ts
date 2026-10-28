import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as stud from './stud-game';

export const studAdapter: GameAdapter<'stud'> = {
  gameType: 'stud',
  getGameState: stud.getGameState,
  exportGames: stud.exportGames,
  restoreGames: stud.restoreGames,
  abortGame: stud.abortGame,
  start: ({ roomCode, players }) => {
    stud.startGame(roomCode, players);
    return { success: true };
  },
  // The match opens by dealing the first hand.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() => stud.act(code, seat, action))),
  getPlayerVisibleState: stud.getPlayerVisibleState,
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
