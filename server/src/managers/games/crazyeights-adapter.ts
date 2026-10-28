import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import { cePlayableCards } from '@shared/rules/crazyeights';
import * as crazyeights from './crazyeights-game';

export const crazyEightsAdapter: GameAdapter<'crazyeights'> = {
  gameType: 'crazyeights',
  getGameState: crazyeights.getGameState,
  exportGames: crazyeights.exportGames,
  restoreGames: crazyeights.restoreGames,
  abortGame: crazyeights.abortGame,
  start: ({ roomCode, players, options }) => {
    crazyeights.startGame(roomCode, players, undefined, undefined, options.crazyeights);
    return { success: true };
  },
  // The match opens by dealing the first hand.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() => {
    switch (action.type) {
      case 'play': return crazyeights.play(code, seat, action.card, action.suit);
      case 'draw': return crazyeights.draw(code, seat);
      case 'pass': return crazyeights.pass(code, seat);
    }
  })),
  getPlayerVisibleState: crazyeights.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // A new hand refills reserves; drawing a playable card keeps the same decision window open, and a
  // turn with nothing playable has no real decision to charge.
  clockBeforeAction: (game, seat) => {
    const hands = game.hands;
    const forced = cePlayableCards(game.hands[seat], game.discard[game.discard.length - 1], game.activeSuit).length === 0;
    return (after) => ({
      redealt: after.hands !== hands,
      sameTurn: after.currentTurnSeat === seat && after.hands === hands && after.drawn,
      forced,
    });
  },
  matchResult: (game) => game.result,
};
