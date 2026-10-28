import { bjBetSeconds, bjSitsIn } from '@shared/rules/blackjack';
import { occupiedSeats } from '@shared/rules/seats';
import type { GameAdapter } from './game-adapter';
import { withObservedHands } from './game-adapter';
import * as tenhalf from './tenhalf-game';

export const tenHalfAdapter: GameAdapter<'tenhalf'> = {
  gameType: 'tenhalf',
  getGameState: tenhalf.getGameState,
  exportGames: tenhalf.exportGames,
  restoreGames: tenhalf.restoreGames,
  abortGame: tenhalf.abortGame,
  start: ({ roomCode, players, settings }) => {
    tenhalf.startGame(roomCode, players, bjBetSeconds(settings.baseSeconds) * 1000);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    switch (action.type) {
      case 'bet': return context.simultaneous(() => {
        const before = tenhalf.getGameState(code)?.hand;
        const result = context.present(() => tenhalf.bet(code, seat, action.amount, context.automatic));
        // The last simultaneous bet deals a hand and refills every reserve.
        if (result.success && tenhalf.getGameState(code)?.hand !== before) context.resetClock();
        return result;
      });
      case 'act': return context.timed(() => context.present(() => tenhalf.act(code, seat, action.action)));
    }
  },
  getPlayerVisibleState: tenhalf.getPlayerVisibleState,
  // God view adds every seat's face-down card.
  withObserverView: (visible, game, observer) => withObservedHands(visible, Object.fromEntries(
    game.dealt.flatMap((seat) => game.holes[seat] ? [[seat, [game.holes[seat]]]] : [])), observer),
  // Bets share a deadline; only playing turns belong to one seat.
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // The next hand's betting window starts only after the settlement has been shown.
  afterPresentation: (game, endsAt) => tenhalf.openBetting(game.roomCode, endsAt),
  sharedDeadline: {
    window: (game) => (game.phase === 'betting' && game.betDeadline !== null
      ? { key: `${game.id}:bet:${game.hand}`, deadline: game.betDeadline } : null),
    pendingSeats: tenhalf.pendingBetSeats,
    owingSeats: (game) => (game.phase !== 'betting' ? null : occupiedSeats(game.players)
      .filter((seat) => game.pendingBets[seat] === null && seat !== game.banker && bjSitsIn(game.chips[seat]))),
  },
  matchResult: (game) => game.result,
};
