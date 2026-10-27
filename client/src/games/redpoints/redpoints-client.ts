import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveRedPointsRounds } from './redpoints-rounds';

export const redPointsClient: ClientGame<'redpoints'> = {
  gameType: 'redpoints',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    redPoints: retain(state.redPoints, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('redpoints.rulesPair'), t('redpoints.rulesTurn'), t('redpoints.rulesScore')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveRedPointsRounds },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true },
  handBeside: false,
  lobbyIcon: { glyph: '🔴', icon: 'circle', red: true },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.matchPoints', n: String(gameSeatValue(result.points, mySeat) ?? 0) } : null,
    }),
  },
};
