import { nnRank, nnWinners } from '@shared/rules/ninetynine';
import type { ClientGame } from '../client-game';
import { spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveNinetyNineRounds } from './ninetynine-rounds';

export const ninetyNineClient: ClientGame<'ninetynine'> = {
  gameType: 'ninetynine',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    ninetyNine: retain(state.ninetyNine, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (context, t) => [t('ninetynine.rulesNumbers'), t('ninetynine.rulesSpecial'), t('ninetynine.rulesBust'),
      ...(context?.option?.enabled ? [t('ninetynine.rulesTwoDecks')] : [])],
    roomContext: (room) => ({ option: { label: 'ninetynine.twoDecks', enabled: room.gameOptions?.ninetynine?.twoDecks ?? false } }),
    matchContext: (game) => ({ option: { label: 'ninetynine.twoDecks', enabled: game.options?.twoDecks ?? false } }),
  },
  roundHistory: { derive: deriveNinetyNineRounds },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: true,
  lobbyIcon: { glyph: '💯' },
  settlement: (game) => game.result,
  result: {
    winners: nnWinners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: nnWinners(result),
      detail: mySeat ? { key: 'history.rank', n: String(nnRank(result, mySeat)) } : null,
    }),
  },
};
