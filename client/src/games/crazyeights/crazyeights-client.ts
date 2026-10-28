import type { ClientGame } from '../client-game';
import { spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveCrazyEightsRounds } from './crazyeights-rounds';

export const crazyEightsClient: ClientGame<'crazyeights'> = {
  gameType: 'crazyeights',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    crazyEights: retain(state.crazyEights, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (context, t) => [t('crazyeights.rulesPlay'), t('crazyeights.rulesWild'), t('crazyeights.rulesDraw'),
      t('crazyeights.rulesScore'), ...(context?.option?.enabled ? [t('crazyeights.rulesActionCards')] : [])],
    roomContext: (room) => ({
      option: { label: 'crazyeights.actionCards', enabled: room.gameOptions?.crazyeights?.actionCards ?? false },
    }),
    matchContext: (game) => ({ option: { label: 'crazyeights.actionCards', enabled: game.options.actionCards } }),
  },
  roundHistory: { derive: deriveCrazyEightsRounds, followsPresentation: true },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: true,
  lobbyIcon: { glyph: '8️⃣' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.penalty', n: String(result.scores[mySeat] ?? 0) } : null,
    }),
  },
};
