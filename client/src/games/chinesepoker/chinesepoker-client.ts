import { gameSeatValue } from '@shared/rules/seats';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export const chinesePokerClient: ClientGame<'chinesepoker'> = {
  gameType: 'chinesepoker',
  // The store phase only separates an active game from scoring; arranging is simultaneous,
  // so no single seat holds the turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'arranging' ? 'playing' : game.phase,
    chinesePoker: retain(state.chinesePoker, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ ...spectatorHand(view, seat), myArrangement: null }),
  rules: {
    summary: (_context, t) => [t('chinesepoker.rulesRows'), t('chinesepoker.rulesFoul'), t('chinesepoker.rulesValues'),
      t('chinesepoker.rulesSweep')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '🀄' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat ? { key: 'history.score', n: signed(gameSeatValue(result.scores, mySeat) ?? 0) } : null,
    }),
  },
};
