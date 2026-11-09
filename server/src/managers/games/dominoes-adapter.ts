import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import { dmTurnOptions } from '@shared/rules/dominoes';
import * as dominoes from './dominoes-game';

export const dominoesAdapter: GameAdapter<'dominoes'> = {
  gameType: 'dominoes',
  getGameState: dominoes.getGameState,
  exportGames: dominoes.exportGames,
  restoreGames: dominoes.restoreGames,
  abortGame: dominoes.abortGame,
  start: ({ roomCode, players, options }) => {
    dominoes.startGame(roomCode, players, undefined, options.dominoes);
    return { success: true };
  },
  // The match opens by dealing the first round.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() => {
    switch (action.type) {
      case 'play': return dominoes.play(code, seat, action.tile, action.side);
      case 'draw': return dominoes.draw(code, seat);
      case 'pass': return dominoes.pass(code, seat);
    }
  })),
  getPlayerVisibleState: dominoes.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // A new round refills reserves; drawing keeps the same decision window open, and a turn with nothing
  // playable has no real decision to charge.
  clockBeforeAction: (game, seat) => {
    const round = game.round;
    const forced = dmTurnOptions(game.hands[seat], game.line, game.boneyard.length, game.openingTile).plays.length === 0;
    return (after) => ({
      redealt: after.round !== round,
      sameTurn: after.round === round && after.currentTurnSeat === seat,
      forced,
    });
  },
  matchResult: (game) => game.result,
};
