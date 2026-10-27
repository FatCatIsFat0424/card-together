import { DEFAULT_TIME_CONTROL } from '@shared/time-control';
import type { BigTwoGameState } from '@shared/types';
import type { GameAdapter } from './game-adapter';
import { compassView, startFullTable, withObservedHands } from './game-adapter';
import * as bigtwo from './bigtwo-game';

/** Keeps a forced pass inside the public turn allowance so it never looks like a timeout. */
function autoPassMaxDelay(game: BigTwoGameState): number {
  return Math.min(bigtwo.AUTO_PASS_MAX_DELAY_MS, (game.clock?.settings ?? DEFAULT_TIME_CONTROL).baseSeconds * 1000);
}

/** Schedules the next forced pass, if any, after the presentation ending at `presentationEndsAt`. */
export function prepareAutoPass(game: BigTwoGameState, presentationEndsAt: number): void {
  bigtwo.prepareAutoPass(game.roomCode, presentationEndsAt, autoPassMaxDelay(game));
}

export const bigTwoAdapter: GameAdapter<'bigtwo'> = {
  gameType: 'bigtwo',
  getGameState: bigtwo.getGameState,
  exportGames: bigtwo.exportGames,
  restoreGames: bigtwo.restoreGames,
  abortGame: bigtwo.abortGame,
  start: ({ roomCode, players }) => startFullTable(players, (table) => bigtwo.startGame(roomCode, table)),
  getPlayerVisibleState: (roomCode, seat) => compassView(seat, (compass) => bigtwo.getPlayerVisibleState(roomCode, compass)),
  withObserverView: (visible, game, observer) => withObservedHands(visible, game.hands, observer),
  turnSeat: (game) => game.currentTurnSeat,
  // A forced pass offered no decision, so it never charges the reserve.
  clockBeforeAction: (game, seat) => {
    const forced = game.pendingAutoPass?.seat === seat;
    return () => ({ forced });
  },
  // The durable forced-pass scheduler owns these turns, including bot seats.
  forcedActionPending: (game) => Boolean(game.pendingAutoPass),
  afterPresentation: prepareAutoPass,
  matchResult: (game) => game.result,
};
