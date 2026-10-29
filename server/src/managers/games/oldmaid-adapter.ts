import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as oldmaid from './oldmaid-game';

export const oldMaidAdapter: GameAdapter<'oldmaid'> = {
  gameType: 'oldmaid',
  getGameState: oldmaid.getGameState,
  exportGames: oldmaid.exportGames,
  restoreGames: oldmaid.restoreGames,
  abortGame: oldmaid.abortGame,
  start: ({ roomCode, players }) => {
    oldmaid.startGame(roomCode, players);
    return { success: true };
  },
  // The match opens with the deal and the first pair discards.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => {
    // Reordering one's own hand is private and not a turn: no clock charge, no presentation.
    if (action.type === 'reorder') return context.simultaneous(() => oldmaid.reorder(code, seat, action.order));
    return context.timed(() => context.present(() => oldmaid.draw(code, seat, action.index, action.reorder)));
  },
  getPlayerVisibleState: oldmaid.getPlayerVisibleState,
  // God view adds every seat's hand, face up.
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // Each deal starts afresh, which refills reserves.
  clockBeforeAction: (game) => {
    const deal = game.deal;
    return (after) => ({ redealt: after.deal !== deal });
  },
  matchResult: (game) => game.result,
};
