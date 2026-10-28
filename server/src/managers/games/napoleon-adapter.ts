import { napoleonReviewSeconds } from '@shared/rules/napoleon';
import { occupiedSeats } from '@shared/rules/seats';
import type { NapoleonGameState } from '@shared/types';
import type { GameAdapter } from './game-adapter';
import * as napoleon from './napoleon-game';

function deals(game: NapoleonGameState): number {
  return game.log.filter((entry) => entry.type === 'deal').length;
}

export const napoleonAdapter: GameAdapter<'napoleon'> = {
  gameType: 'napoleon',
  getGameState: napoleon.getGameState,
  exportGames: napoleon.exportGames,
  restoreGames: napoleon.restoreGames,
  abortGame: napoleon.abortGame,
  start: ({ roomCode, players, options }) => {
    napoleon.startGame(roomCode, players, options.napoleon);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => context.timed(() => context.present(() =>
    napoleon.act(code, seat, action, napoleonReviewSeconds(context.settings.baseSeconds) * 1000))),
  getPlayerVisibleState: napoleon.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => ({ ...visible, observer, ...napoleon.getObserverView(game) }),
  // Discards are acknowledged against a shared deadline, not one seat's turn.
  turnSeat: (game) => (game.phase === 'reviewing' ? null : game.currentTurnSeat),
  // An all-pass auction redeals, which refills reserves like a Bridge redeal.
  clockBeforeAction: (game) => {
    const before = deals(game);
    return (after) => ({ redealt: deals(after) !== before });
  },
  sharedDeadline: {
    window: (game) => (game.phase === 'reviewing' && game.reviewDeadline !== null
      ? { key: `${game.id}:review`, deadline: game.reviewDeadline } : null),
    pendingSeats: napoleon.pendingReviewSeats,
    owingSeats: (game) => (game.phase !== 'reviewing' ? null : occupiedSeats(game.players)
      .filter((seat) => seat !== game.contract?.napoleon && !game.reviewed.includes(seat))),
  },
  matchResult: (game) => game.result,
};
