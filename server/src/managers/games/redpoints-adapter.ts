import type { GameAdapter } from './game-adapter';
import { compassAction, compassView, startFullTable, withObservedHands } from './game-adapter';
import * as redpoints from './redpoints-game';

export const redPointsAdapter: GameAdapter<'redpoints'> = {
  gameType: 'redpoints',
  getGameState: redpoints.getGameState,
  exportGames: redpoints.exportGames,
  restoreGames: redpoints.restoreGames,
  abortGame: redpoints.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => redpoints.startGame(roomCode, table)),
  applyAction: (code, seat, action, context) => compassAction(seat, (player) => context.timed(() => context.present(() =>
    action.type === 'play' ? redpoints.play(code, player, action.card, action.capture)
      : redpoints.chooseFlip(code, player, action.capture)))),
  getPlayerVisibleState: (roomCode, seat) => compassView(seat, (compass) => redpoints.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // Unused allowance carries from playing a card into choosing the flipped card's capture.
  clockBeforeAction: (game) => {
    const playing = game.step === 'play';
    return (after) => ({ sameTurn: playing && after.step === 'flip-choose' });
  },
  matchResult: (game) => game.result,
};
