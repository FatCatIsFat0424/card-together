import type { GameAdapter } from './game-adapter';
import { compassAction, compassView, startFullTable, withObservedHands } from './game-adapter';
import * as bridge from './bridge-game';

export const bridgeAdapter: GameAdapter<'bridge'> = {
  gameType: 'bridge',
  getGameState: bridge.getGameState,
  exportGames: bridge.exportGames,
  restoreGames: bridge.restoreGames,
  abortGame: bridge.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => bridge.startGame(roomCode, table)),
  applyAction: (code, seat, action, context) => compassAction(seat, (player) => {
    switch (action.type) {
      case 'bid': return context.timed(() => bridge.handleBid(code, player, action.bid));
      case 'redeal': return context.timed(() => bridge.handleRedealResponse(code, player, action.accept));
      case 'play': return context.timed(() => context.present(() => bridge.handlePlayCard(code, player, action.card)));
    }
  }),
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
