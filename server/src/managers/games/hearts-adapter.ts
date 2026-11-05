import { HEARTS_DEAL_MS } from '@shared/games/hearts/definition';
import type { GameAdapter } from './game-adapter';
import { startFullTable, compassAction, withObservedHands } from './game-adapter';
import * as hearts from './hearts-game';
export const heartsAdapter: GameAdapter<'hearts'> = {
  gameType: 'hearts', getGameState: hearts.getGameState, exportGames: hearts.exportGames,
  restoreGames: hearts.restoreGames, abortGame: hearts.abortGame,
  start: ({ roomCode, players, settings }) => startFullTable(players, (full) => {
    hearts.startGame(roomCode, full, Math.max(30, settings.baseSeconds) * 1000);
    const game = hearts.getGameState(roomCode);
    if (game?.passDeadline) game.passDeadline += HEARTS_DEAL_MS;
  }),
  presentsOpening: true,
  applyAction: (code, seat, action, context) => compassAction(seat, (compass) => action.type === 'pass'
    ? context.simultaneous(() => {
      const game = hearts.getGameState(code);
      if (!context.automatic && game?.passDeadline !== null && game?.passDeadline !== undefined
        && Date.now() >= game.passDeadline) return { success: false, reason: 'Passing is closed.' };
      const result = context.present(() => hearts.act(code, compass, action));
      // Only the last submission starts a turn; earlier submissions keep the shared clock.
      if (result.success && hearts.getGameState(code)?.phase === 'playing') context.resetClock();
      return result;
    })
    : context.timed(() => context.present(() => hearts.act(code, compass, action)))),
  getPlayerVisibleState: hearts.getPlayerVisibleState,
  withObserverView: (visible, game, observer) => withObservedHands({ ...visible, myPass: [] }, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  clockBeforeAction: (game) => {
    const hand = game.hand;
    return (after) => ({ redealt: after.hand !== hand });
  },
  afterPresentation: (game, endsAt) => {
    if (game.phase === 'passing' && game.log.at(-1)?.type === 'deal') game.passDeadline = endsAt + game.passDurationMs;
  },
  sharedDeadline: {
    window: (game) => game.phase === 'passing' && game.passDeadline !== null
      ? { key: `${game.id}:pass:${game.hand}`, deadline: game.passDeadline } : null,
    pendingSeats: hearts.pendingPassSeats,
    owingSeats: (game) => game.phase === 'passing' ? hearts.pendingPassSeats(game) : null,
  },
  matchResult: (game) => game.result,
};
