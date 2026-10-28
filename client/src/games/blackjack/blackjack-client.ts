import { BJ_HANDS, bjMatchHands } from '@shared/rules/blackjack';
import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveBlackjackRounds } from './blackjack-rounds';

export const blackjackClient: ClientGame<'blackjack'> = {
  gameType: 'blackjack',
  // Betting is simultaneous, so no single seat holds the turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'betting' ? 'playing' : game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    blackjack: retain(state.blackjack, game),
  }),
  observedView: (game) => ({ hole: game.observedHole ?? null }),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => {
      const hands = String(context?.blackjackHands ?? BJ_HANDS);
      return [t('blackjack.rulesBet', { hands }), t('blackjack.rulesPlay'),
        t(context?.option?.enabled ? 'blackjack.rulesPlayerDealer' : 'blackjack.rulesDealer'),
        t('blackjack.rulesPay', { hands })];
    },
    roomContext: (room) => {
      const playerDealer = room.gameOptions?.blackjack?.playerDealer ?? false;
      const seated = [...Object.values(room.seats), ...(room.additionalSeats ?? [])].filter((seat) => seat.player).length;
      return { option: { label: 'blackjack.playerDealer', enabled: playerDealer },
        blackjackHands: bjMatchHands(Math.max(1, seated), playerDealer) };
    },
    matchContext: (game) => ({
      option: { label: 'blackjack.playerDealer', enabled: game.options?.playerDealer ?? false },
      blackjackHands: game.totalHands,
    }),
  },
  roundHistory: { derive: deriveBlackjackRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '🎰' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.chips', n: String(gameSeatValue(result.chips, mySeat) ?? 0) } : null,
    }),
  },
};
