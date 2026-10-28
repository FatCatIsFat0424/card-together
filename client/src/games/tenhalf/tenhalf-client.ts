import { bjMatchHands } from '@shared/rules/blackjack';
import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveTenHalfRounds } from './tenhalf-rounds';

export const tenHalfClient: ClientGame<'tenhalf'> = {
  gameType: 'tenhalf',
  // Betting is simultaneous, so no single seat holds the turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'betting' ? 'playing' : game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    tenhalf: retain(state.tenhalf, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => {
      const hands = String(context?.tenHalfHands ?? 0);
      return [t('tenhalf.rulesBet', { hands }), t('tenhalf.rulesPlay'), t('tenhalf.rulesSpecial'),
        t('tenhalf.rulesPay', { hands })];
    },
    roomContext: (room) => {
      const seated = [...Object.values(room.seats), ...(room.additionalSeats ?? [])].filter((seat) => seat.player).length;
      return { option: null, tenHalfHands: bjMatchHands(Math.max(1, seated), true) };
    },
    matchContext: (game) => ({ option: null, tenHalfHands: game.totalHands }),
  },
  roundHistory: { derive: deriveTenHalfRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '🔟' },
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
