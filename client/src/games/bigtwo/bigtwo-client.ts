import { gameSeatValue } from '@shared/rules/seats';
import { BIGTWO_RANK_ORDER, BIGTWO_SUIT_ORDER } from '@shared/rules/bigtwo';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand } from '../client-game-helpers';
import { deriveBigTwoRounds } from './bigtwo-rounds';

export const bigTwoClient: ClientGame<'bigtwo'> = {
  gameType: 'bigtwo',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    bigTwo: retain(state.bigTwo, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('bigtwo.rulesCombos'), t('bigtwo.rulesOrder'), t('bigtwo.rulesScore')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveBigTwoRounds },
  handSort: {
    order: {
      rank: (card) => BIGTWO_RANK_ORDER.indexOf(card.rank),
      // The strongest suit sits first, like the strongest rank.
      suit: (card) => BIGTWO_SUIT_ORDER.length - 1 - BIGTWO_SUIT_ORDER.indexOf(card.suit),
    },
    bySuit: true,
    initial: 'rank',
  },
  handBeside: false,
  lobbyIcon: { glyph: '🃏' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => [result.winnerSeat],
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: [result.winnerSeat],
      ...(result.dragon ? { suffix: ' 🐉' } : {}),
      detail: mySeat ? { key: 'history.penalty', n: String(gameSeatValue(result.scores, mySeat) ?? 0) } : null,
    }),
  },
};
