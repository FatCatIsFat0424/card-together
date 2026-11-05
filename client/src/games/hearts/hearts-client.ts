import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';
export const heartsClient: ClientGame<'hearts'> = {
  gameType: 'hearts',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'scoring' ? 'scoring' : 'playing', currentTurnSeat: game.currentTurnSeat,
    hearts: retain(state.hearts, game),
  }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ ...spectatorHand(view, seat), validCards: [], myPass: [] }),
  rules: {
    summary: (_context, t) => [t('hearts.rulesDeal'), t('hearts.rulesPass'), t('hearts.rulesPlay'), t('hearts.rulesScore')],
    roomContext: () => NO_RULES_OPTION, matchContext: () => NO_RULES_OPTION,
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' }, handBeside: true,
  lobbyIcon: { glyph: '♥' }, settlement: (game) => game.result,
  result: { winners: (result) => result.winners, sidesWin: false,
    summary: (result, mySeat) => ({ kind: 'winners', winners: result.winners,
      detail: mySeat && mySeat in result.scores ? { key: 'hearts.penalty', n: String(result.scores[mySeat as keyof typeof result.scores]) } : null }),
  },
};
