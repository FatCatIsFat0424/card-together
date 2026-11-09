import { DEFAULT_DOMINOES_OPTIONS } from '@shared/dominoes-options';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveDominoesRounds } from './dominoes-rounds';

export const dominoesClient: ClientGame<'dominoes'> = {
  gameType: 'dominoes',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    dominoes: retain(state.dominoes, game),
  }),
  observedView: (game) => ({ dominoHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myHand: [...view.dominoHands?.[seat] ?? []] }),
  rules: {
    summary: (context, t) => [t('dominoes.rulesPlay'), t('dominoes.rulesDraw'), t('dominoes.rulesScore'),
      t('dominoes.rulesMatch'),
      ...(context?.dominoesTarget ? [t('dominoes.rulesTarget', { n: String(context.dominoesTarget) })] : [])],
    roomContext: (room) => ({
      option: null, dominoesTarget: (room.gameOptions?.dominoes ?? DEFAULT_DOMINOES_OPTIONS).targetScore,
    }),
    matchContext: (game) => ({ option: null, dominoesTarget: game.options.targetScore }),
  },
  roundHistory: { derive: deriveDominoesRounds, followsPresentation: true },
  // The table sorts tiles heaviest first itself, so the tools offer no card sorting.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank', unsortable: true },
  handBeside: false,
  lobbyIcon: { glyph: '🁣' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat && result.seats.includes(mySeat) ? { key: 'history.score', n: String(result.scores[mySeat] ?? 0) } : null,
    }),
  },
};
