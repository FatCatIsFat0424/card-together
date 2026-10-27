import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { nextHeldHoleCards } from './holdem-view';
import { deriveHoldemRounds } from './holdem-rounds';

export const holdemClient: ClientGame<'holdem'> = {
  gameType: 'holdem',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    holdem: retain(state.holdem, game),
    holdemHeld: nextHeldHoleCards(state.holdem, game, state.holdemHeld),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('holdem.rulesChips'), t('holdem.rulesDeal'), t('holdem.rulesAction'),
      t('holdem.rulesShowdown')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveHoldemRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true },
  handBeside: false,
  lobbyIcon: { glyph: '♦️' },
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
