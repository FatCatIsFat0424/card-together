import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveLiarsDeckRounds } from './liarsdeck-rounds';

export const liarsDeckClient: ClientGame<'liarsdeck'> = {
  gameType: 'liarsdeck',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    liarsDeck: retain(state.liarsDeck, game),
  }),
  observedView: (game) => ({ liarHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myHand: [...view.liarHands?.[seat] ?? []], myPlayed: [] }),
  rules: {
    summary: (_context, t) => [t('liarsdeck.rulesDeck'), t('liarsdeck.rulesPlay'), t('liarsdeck.rulesCall'),
      t('liarsdeck.rulesGun')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveLiarsDeckRounds },
  // Its cards differ only by rank, so there is no suit order to offer.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: true,
  lobbyIcon: { glyph: '🍺', icon: 'beer' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => [result.winnerSeat],
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: [result.winnerSeat],
      detail: mySeat ? {
        key: 'history.rank',
        n: String(mySeat === result.winnerSeat ? 1 : 4 - result.eliminationOrder.findIndex((seat) => seat === mySeat)),
      } : null,
    }),
  },
};
