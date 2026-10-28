import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { deriveLiarsDiceRounds } from './liarsdice-rounds';

export const liarsDiceClient: ClientGame<'liarsdice'> = {
  gameType: 'liarsdice',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    liarsDice: retain(state.liarsDice, game),
  }),
  observedView: (game) => ({ diceHands: game.observedHands ?? null }),
  spectatorPatch: (view, seat) => ({ myDice: [...view.diceHands?.[seat] ?? []] }),
  rules: {
    summary: (_context, t) => [t('liarsdice.rulesDice'), t('liarsdice.rulesBid'), t('liarsdice.rulesCall'),
      t('liarsdice.rulesOnes')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  roundHistory: { derive: deriveLiarsDiceRounds },
  // Dice are shown high to left without a player-controlled order, so the table tools omit sorting.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank', unsortable: true },
  handBeside: false,
  lobbyIcon: { glyph: '🎲' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => [result.winnerSeat],
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: [result.winnerSeat],
      detail: mySeat && result.seats.includes(mySeat) ? {
        key: 'history.rank',
        n: String(mySeat === result.winnerSeat ? 1 : result.seats.length - result.eliminationOrder.indexOf(mySeat)),
      } : null,
    }),
  },
};
