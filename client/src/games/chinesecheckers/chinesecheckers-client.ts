import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';

export const chineseCheckersClient: ClientGame<'chinesecheckers'> = {
  gameType: 'chinesecheckers',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    chineseCheckers: retain(state.chineseCheckers, game),
  }),
  // The whole position is public, so there is nothing extra for observers to see.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (_context, t) => [t('cc.rulesMove'), t('cc.rulesWin'), t('cc.rulesEnd')],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  // The move list lives in the board table's panel, and there is no hand to sort.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '✡' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
