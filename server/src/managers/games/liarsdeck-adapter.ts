import type { GameAdapter } from './game-adapter';
import { compassView, startFullTable } from './game-adapter';
import * as liarsdeck from './liarsdeck-game';

export const liarsDeckAdapter: GameAdapter<'liarsdeck'> = {
  gameType: 'liarsdeck',
  getGameState: liarsdeck.getGameState,
  exportGames: liarsdeck.exportGames,
  restoreGames: liarsdeck.restoreGames,
  abortGame: liarsdeck.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => liarsdeck.startGame(roomCode, table)),
  // The match opens by revealing the first round's table card.
  presentsOpening: true,
  getPlayerVisibleState: (roomCode, seat) => compassView(seat, (compass) => liarsdeck.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => ({ ...visible, observer, observedHands: game.hands }),
  eliminationIndex: (game, seat) => game.log.findIndex((entry) => entry.type === 'shot' && entry.seat === seat
    && !entry.survived),
  turnSeat: (game) => game.currentTurnSeat,
  // Each round is a new deal, which refills reserves.
  clockBeforeAction: (game) => {
    const hands = game.hands;
    return (after) => ({ redealt: after.hands !== hands });
  },
  matchResult: (game) => game.result,
};
