import { cpArrangeSeconds } from '@shared/rules/chinesepoker';
import { occupiedSeats } from '@shared/rules/seats';
import type { GameAdapter } from './game-adapter';
import { compassView, startFullTable, withObservedHands } from './game-adapter';
import * as chinesepoker from './chinesepoker-game';

export const chinesePokerAdapter: GameAdapter<'chinesepoker'> = {
  gameType: 'chinesepoker',
  getGameState: chinesepoker.getGameState,
  exportGames: chinesepoker.exportGames,
  restoreGames: chinesepoker.restoreGames,
  abortGame: chinesepoker.abortGame,
  start: ({ roomCode, players, settings }) => startFullTable(players, (table) => chinesepoker.startGame(roomCode, table,
    cpArrangeSeconds(settings.baseSeconds, settings.bankSeconds) * 1000)),
  getPlayerVisibleState: (roomCode, seat) => compassView(seat,
    (compass) => chinesepoker.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  // Seats arrange simultaneously against the game's own shared deadline.
  turnSeat: () => null,
  sharedDeadline: {
    window: (game) => (game.phase === 'arranging' ? { key: `${game.id}:arrange`, deadline: game.arrangeDeadline } : null),
    pendingSeats: chinesepoker.pendingSeats,
    owingSeats: (game) => occupiedSeats(game.players)
      .filter((seat) => game.arrangements[seat as keyof typeof game.arrangements] === null),
  },
  matchResult: (game) => game.result,
};
