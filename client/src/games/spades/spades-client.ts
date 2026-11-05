import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, spectatorHand, STANDARD_HAND_ORDER } from '../client-game-helpers';

export const spadesClient: ClientGame<'spades'> = {
  gameType: 'spades',
  restoreSnapshot: (game, { state, retain }) => ({ phase: game.phase, currentTurnSeat: game.currentTurnSeat,
    dealerSeat: game.dealerSeat, spades: retain(state.spades, game) }),
  observedView: (game) => ({ hands: game.observedHands ?? null }),
  spectatorPatch: spectatorHand,
  rules: {
    summary: (_context, t) => [t('spades.rulesDeal'), t('spades.rulesBid'), t('spades.rulesPlay'),
      t('spades.rulesScore'), t('spades.rulesNil'), t('spades.rulesBags'), t('spades.rulesWin')],
    roomContext: () => NO_RULES_OPTION, matchContext: () => NO_RULES_OPTION,
  },
  handSort: { order: STANDARD_HAND_ORDER, bySuit: true, initial: 'rank' },
  handBeside: true, lobbyIcon: { glyph: '♠' }, settlement: (game) => game.result,
  result: { winners: (result) => result.winners, sidesWin: true,
    summary: (result, _seat, t) => ({ kind: 'text', text: `${t('table.teamNS')} ${result.scores.NS} · ${t('table.teamEW')} ${result.scores.EW}` }) },
};
