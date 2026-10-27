import type { GameAdapter } from './game-adapter';
import { compassView, startFullTable, withObservedHands } from './game-adapter';
import * as bridge from './bridge-game';

export const bridgeAdapter: GameAdapter<'bridge'> = {
  gameType: 'bridge',
  getGameState: bridge.getGameState,
  exportGames: bridge.exportGames,
  restoreGames: bridge.restoreGames,
  abortGame: bridge.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => bridge.startGame(roomCode, table)),
  getPlayerVisibleState: (roomCode, seat) => compassView(seat, (compass) => bridge.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => {
    if (game.phase === 'redeal_pending') return game.redealPendingSeat;
    if (game.phase === 'bidding') return game.bidding?.currentBidderSeat ?? null;
    return game.phase === 'playing' ? game.playing?.currentTurnSeat ?? null : null;
  },
  // Each redeal is a new deal, which refills reserves.
  clockBeforeAction: (game) => {
    const hands = game.hands;
    return (after) => ({ redealt: after.hands !== hands });
  },
  // Bridge results predate the game type field.
  matchResult: (game) => (game.result ? { ...game.result, gameType: 'bridge' } : null),
};
