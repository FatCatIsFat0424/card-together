import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';

export const jungleClient: ClientGame<'jungle'> = {
  gameType: 'jungle',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    jungle: retain(state.jungle, game),
  }),
  // The whole position is public, so there is nothing extra for observers to see.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (_context, t) => [t('jungle.rulesRanks'), t('jungle.rulesRiver'), t('jungle.rulesWin')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  // The move list lives in the board table's panel, so there are no rounds to list.
  // There is no hand to sort; the board table never shows the sort tools.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '🐘' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
