import type { GameAdapter } from './game-adapter';
import { compassAction, compassView, startFullTable } from './game-adapter';
import * as sevens from './sevens-game';

export const sevensAdapter: GameAdapter<'sevens'> = {
  gameType: 'sevens',
  getGameState: sevens.getGameState,
  exportGames: sevens.exportGames,
  restoreGames: sevens.restoreGames,
  abortGame: sevens.abortGame,
  start: ({ roomCode, players, options }) => startFullTable(players,
    (table) => sevens.startGame(roomCode, table, undefined, options.sevens)),
  applyAction: (code, seat, action, context) => compassAction(seat, (player) => context.timed(() => context.present(() =>
    action.type === 'play' ? sevens.play(code, player, action.card) : sevens.cover(code, player, action.card)))),
  getPlayerVisibleState: (roomCode, seat) => compassView(seat, (compass) => sevens.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => ({ ...visible, observer, observedHands: game.hands,
    observedCovered: game.covered }),
  turnSeat: (game) => game.currentTurnSeat,
  matchResult: (game) => game.result,
};
