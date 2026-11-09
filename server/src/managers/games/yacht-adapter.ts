import { DEFAULT_YACHT_OPTIONS, yachtRoundSeconds } from '@shared/rules/yacht';
import type { GameActionResult, GameAdapter } from './game-adapter';
import * as yacht from './yacht-game';

export const yachtAdapter: GameAdapter<'yacht'> = {
  gameType: 'yacht',
  getGameState: yacht.getGameState,
  exportGames: yacht.exportGames,
  restoreGames: yacht.restoreGames,
  abortGame: yacht.abortGame,
  start: ({ roomCode, players, settings, options }) => {
    yacht.startGame(roomCode, players, options.yacht ?? DEFAULT_YACHT_OPTIONS, yachtRoundSeconds(settings.baseSeconds) * 1000);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    const game = yacht.getGameState(code);
    const run = (): GameActionResult => {
      switch (action.type) {
        case 'roll': return yacht.roll(code, seat, action.held);
        case 'hold': return yacht.hold(code, seat, action.held);
        case 'score': return yacht.score(code, seat, action.box);
        case 'auto': return yacht.autoPlay(code, seat);
      }
    };
    // Only the timeout schedulers play a seat's whole turn at once.
    if (action.type === 'auto' && !context.automatic) return { success: false, reason: 'Invalid action.' };
    if (game?.options.mode !== 'simultaneous') return context.timed(run);
    return context.simultaneous(() => {
      if (!context.automatic && game.roundDeadline !== null && Date.now() >= game.roundDeadline) {
        return { success: false, reason: 'The round time is over' };
      }
      return run();
    });
  },
  getPlayerVisibleState: yacht.getPlayerVisibleState,
  // Dice and scorecards are public, so spectators see nothing more than players do.
  withObserverView: (visible, _game, observer) => ({ ...visible, observer }),
  turnSeat: (game) => (game.phase === 'playing' && game.options.mode === 'turns' ? game.currentTurnSeat : null),
  // Rolls and holds keep one turn's clock running; scoring passes the turn, and a new round refills the reserves.
  clockBeforeAction: (game, seat) => {
    const round = game.round;
    return (after) => ({
      sameTurn: after.phase === 'playing' && after.round === round && after.currentTurnSeat === seat,
      redealt: after.round !== round,
    });
  },
  // Every seat rolls its own dice against one durable round deadline; a missing score is made automatically.
  sharedDeadline: {
    window: (game) => (game.phase === 'playing' && game.roundDeadline !== null
      ? { key: `${game.id}:round:${game.round}`, deadline: game.roundDeadline } : null),
    pendingSeats: yacht.pendingSeats,
    owingSeats: (game) => (game.phase === 'playing' && game.options.mode === 'simultaneous' ? yacht.pendingSeats(game) : null),
  },
  matchResult: (game) => game.result,
};
