import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as liarsdice from './liarsdice-game';

export const liarsDiceAdapter: GameAdapter<'liarsdice'> = {
  gameType: 'liarsdice',
  getGameState: liarsdice.getGameState,
  exportGames: liarsdice.exportGames,
  restoreGames: liarsdice.restoreGames,
  abortGame: liarsdice.abortGame,
  start: ({ roomCode, players }) => {
    liarsdice.startGame(roomCode, players);
    return { success: true };
  },
  // The match opens by rolling the first round.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() =>
    action.type === 'bid' ? liarsdice.bid(code, seat, action.quantity, action.face) : liarsdice.challenge(code, seat))),
  getPlayerVisibleState: liarsdice.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  eliminationIndex: (game, seat) => game.log.findIndex((entry) => entry.type === 'challenge' && entry.eliminated
    && entry.loser === seat),
  turnSeat: (game) => game.currentTurnSeat,
  // Each round is a new roll, which refills reserves.
  clockBeforeAction: (game) => {
    const hands = game.hands;
    return (after) => ({ redealt: after.hands !== hands });
  },
  matchResult: (game) => game.result,
};
