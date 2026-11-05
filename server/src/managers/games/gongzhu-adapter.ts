import type { GameAdapter } from './game-adapter';
import { compassAction, compassView, startFullTable, withObservedHands } from './game-adapter';
import * as gongzhu from './gongzhu-game';

export const gongZhuAdapter: GameAdapter<'gongzhu'> = {
  gameType: 'gongzhu', getGameState: gongzhu.getGameState, exportGames: gongzhu.exportGames,
  restoreGames: gongzhu.restoreGames, abortGame: gongzhu.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => gongzhu.startGame(roomCode, table)),
  presentsOpening: true,
  applyAction: (code, seat, action, context) => compassAction(seat, (compass) => context.timed(() => context.present(() =>
    gongzhu.playCard(code, compass, action.card)))),
  getPlayerVisibleState: (code, seat) => compassView(seat, (compass) => gongzhu.getPlayerVisibleState(code, compass)),
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.phase === 'playing' ? game.currentTurnSeat : null,
  clockBeforeAction: (game) => { const hand = game.hand; return (after) => ({ redealt: after.hand !== hand }); },
  matchResult: (game) => game.result,
};
