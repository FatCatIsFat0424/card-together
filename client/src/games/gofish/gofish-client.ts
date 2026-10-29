import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveGoFishRounds } from './gofish-rounds';

export const goFishClient: ClientGame<'gofish'> = {
  gameType: 'gofish',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    goFish: retain(state.goFish, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('gofish.rulesDeal'), t('gofish.rulesAsk'), t('gofish.rulesFish'),
      t('gofish.rulesBooks'), t('gofish.rulesScore')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveGoFishRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: true,
  lobbyIcon: { glyph: '🎣' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat && result.seats?.includes(mySeat) ? { key: 'gofish.historyBooks', n: String(result.scores[mySeat] ?? 0) } : null,
    }),
  },
};
