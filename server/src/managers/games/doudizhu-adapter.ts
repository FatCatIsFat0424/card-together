import type { CardOrJoker } from '@shared/types';
import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as doudizhu from './doudizhu-game';

export const douDizhuAdapter: GameAdapter<'doudizhu'> = {
  gameType: 'doudizhu',
  getGameState: doudizhu.getGameState,
  exportGames: doudizhu.exportGames,
  restoreGames: doudizhu.restoreGames,
  abortGame: doudizhu.abortGame,
  start: ({ roomCode, players, options }) => {
    doudizhu.startGame(roomCode, players, options.doudizhu);
    return { success: true };
  },
  // The match opens by dealing the first hand.
  presentsOpening: true,
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() => {
    switch (action.type) {
      case 'bid': return doudizhu.bid(code, seat, action.score);
      case 'claim': return doudizhu.claim(code, seat, action.take);
      case 'play': return doudizhu.play(code, seat, action.cards);
      case 'pass': return doudizhu.pass(code, seat);
    }
  })),
  getPlayerVisibleState: doudizhu.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands<typeof visible, CardOrJoker>(visible,
    Object.fromEntries(doudizhu.tableSeats(game).map((seat) => [seat, game.hands[seat]])), observer),
  turnSeat: (game) => game.currentTurnSeat,
  // Each deal and each voided auction is a new deal, which refills reserves.
  clockBeforeAction: (game) => {
    const { deal, redeals } = game;
    return (after) => ({ redealt: after.deal !== deal || after.redeals !== redeals });
  },
  matchResult: (game) => game.result,
};
