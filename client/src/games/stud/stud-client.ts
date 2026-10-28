import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { nextHeldHoleCards } from '../holdem/holdem-view';
import { deriveStudRounds } from './stud-rounds';

export const studClient: ClientGame<'stud'> = {
  gameType: 'stud',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    stud: retain(state.stud, game),
    studHeld: nextHeldHoleCards(state.stud, game, state.studHeld),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('stud.rulesChips'), t('stud.rulesDeal'), t('stud.rulesAction'), t('stud.rulesShowdown')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveStudRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '♠️' },
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
