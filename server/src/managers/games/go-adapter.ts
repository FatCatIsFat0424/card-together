import { isMatchControl } from '@shared/rules/board/match-controls';
import { goMarkSeconds } from '@shared/rules/go-match';
import type { GameAdapter } from './game-adapter';
import * as go from './go-game';

export const goAdapter: GameAdapter<'go'> = {
  gameType: 'go',
  getGameState: go.getGameState,
  exportGames: go.exportGames,
  restoreGames: go.restoreGames,
  abortGame: go.abortGame,
  start: ({ roomCode, players, options }) => {
    go.startGame(roomCode, players, options.go);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    // Resigning belongs to no turn, so neither the clock nor a presentation applies.
    if (isMatchControl(action)) return go.control(code, seat, action);
    const markMs = goMarkSeconds(context.settings.baseSeconds, context.settings.bankSeconds) * 1000;
    switch (action.type) {
      case 'place': return context.timed(() => go.place(code, seat, action.to, markMs));
      case 'pass': return context.timed(() => go.pass(code, seat, markMs));
      // Marking is a joint decision against one deadline, so it charges no clock.
      case 'toggle-dead': return context.simultaneous(() => go.toggleDead(code, seat, action.to, context.automatic));
      case 'confirm-score': return context.simultaneous(() => go.confirmScore(code, seat, action.dead, context.automatic));
      // Resuming starts the mover's turn clock, which only a timed action does.
      case 'resume': return context.timed(() => go.resume(code, seat, context.automatic));
    }
  },
  getPlayerVisibleState: go.getPlayerVisibleState,
  // Nothing is hidden, so a spectator sees the same position as the players.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // Both seats accept the dead stones against one durable deadline; a human who misses it accepts the proposal.
  sharedDeadline: {
    window: (game) => (game.phase === 'marking' ? { key: `${game.id}:mark:${game.resumes.length}`, deadline: game.markDeadline } : null),
    pendingSeats: go.pendingSeats,
    owingSeats: (game) => (game.phase === 'marking' ? go.pendingSeats(game) : null),
  },
  matchResult: (game) => game.result,
};
