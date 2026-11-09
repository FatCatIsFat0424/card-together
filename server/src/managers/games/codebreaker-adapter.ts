import { DEFAULT_CODEBREAKER_OPTIONS, cbRoundSeconds } from '@shared/rules/codebreaker';
import type { GameAdapter } from './game-adapter';
import * as codebreaker from './codebreaker-game';

export const codeBreakerAdapter: GameAdapter<'codebreaker'> = {
  gameType: 'codebreaker',
  getGameState: codebreaker.getGameState,
  exportGames: codebreaker.exportGames,
  restoreGames: codebreaker.restoreGames,
  abortGame: codebreaker.abortGame,
  start: ({ roomCode, players, settings, options }) => {
    codebreaker.startGame(roomCode, players, options.codebreaker ?? DEFAULT_CODEBREAKER_OPTIONS,
      cbRoundSeconds(settings.baseSeconds, settings.bankSeconds) * 1000);
    return { success: true };
  },
  // Every active seat guesses once per round, so no single seat's clock runs.
  applyAction: (code, seat, action, context) => context.simultaneous(() => codebreaker.guess(code, seat, action.code, context.automatic)),
  getPlayerVisibleState: codebreaker.getPlayerVisibleState,
  // Only unseated spectators reach this (no seat is eliminated): they see the secret and every guess.
  withObserverView: codebreaker.withObserverView,
  turnSeat: () => null,
  // Each round is one shared window; a seat that has not guessed when it expires gets a random consistent guess.
  sharedDeadline: {
    window: (game) => (game.phase === 'playing' ? { key: `${game.id}:round:${game.round}`, deadline: game.roundDeadline } : null),
    pendingSeats: codebreaker.pendingSeats,
    owingSeats: (game) => (game.phase === 'playing' ? codebreaker.pendingSeats(game) : null),
  },
  matchResult: (game) => game.result,
};
