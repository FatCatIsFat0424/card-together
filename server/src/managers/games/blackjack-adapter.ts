import { bjBetSeconds, bjSitsIn } from '@shared/rules/blackjack';
import { occupiedSeats } from '@shared/rules/seats';
import type { GameAdapter } from './game-adapter';
import * as blackjack from './blackjack-game';

export const blackjackAdapter: GameAdapter<'blackjack'> = {
  gameType: 'blackjack',
  getGameState: blackjack.getGameState,
  exportGames: blackjack.exportGames,
  restoreGames: blackjack.restoreGames,
  abortGame: blackjack.abortGame,
  start: ({ roomCode, players, settings, options }) => {
    blackjack.startGame(roomCode, players, bjBetSeconds(settings.baseSeconds) * 1000, undefined, options.blackjack);
    return { success: true };
  },
  applyAction: (code, seat, action, context) => {
    switch (action.type) {
      case 'bet': return context.simultaneous(() => {
        const before = blackjack.getGameState(code)?.hand;
        const result = context.present(() => blackjack.bet(code, seat, action.amount, context.automatic));
        // The last simultaneous bet deals a hand and refills every reserve.
        if (result.success && blackjack.getGameState(code)?.hand !== before) context.resetClock();
        return result;
      });
      case 'act': return context.timed(() => context.present(() => blackjack.act(code, seat, action.action)));
      case 'dealerAct': return context.timed(() => context.present(() => blackjack.dealerAct(code, seat, action.action)));
    }
  },
  getPlayerVisibleState: blackjack.getPlayerVisibleState,
  // Hands are dealt face up; god view only adds the dealer's hidden hole card.
  withObserverView: (visible, game, observer) => (game.hole
    ? { ...visible, observer, observedHole: game.hole } : { ...visible, observer }),
  // Chips only grow by betting, so a seat that cannot cover the minimum never plays again. A
  // player dealer can still win chips back when its deal comes round, so nobody is out for good.
  eliminationIndex: (game, seat) => (!game.players[seat] || game.dealerSeat ? -1
    : game.log.findIndex((entry) => entry.type === 'settle' && !bjSitsIn(entry.chips[seat]))),
  // Bets share a deadline; only playing turns belong to one seat.
  turnSeat: (game) => (game.phase === 'playing' ? game.currentTurnSeat : null),
  // The next hand's betting window starts only after the settlement has been shown.
  afterPresentation: (game, endsAt) => blackjack.openBetting(game.roomCode, endsAt),
  sharedDeadline: {
    window: (game) => (game.phase === 'betting' && game.betDeadline !== null
      ? { key: `${game.id}:bet:${game.hand}`, deadline: game.betDeadline } : null),
    pendingSeats: blackjack.pendingBetSeats,
    owingSeats: (game) => (game.phase !== 'betting' ? null : occupiedSeats(game.players)
      .filter((seat) => game.bets[seat] === null && seat !== game.dealerSeat && bjSitsIn(game.chips[seat]))),
  },
  matchResult: (game) => game.result,
};
