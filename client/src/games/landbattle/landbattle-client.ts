import { LB_QUIET_LIMIT } from '@shared/rules/landbattle';
import type { ClientGame } from '../client-game';
import { NO_RULES_OPTION, STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';

export const landBattleClient: ClientGame<'landbattle'> = {
  gameType: 'landbattle',
  // Deployment is simultaneous, so no single seat holds the turn until play starts.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'deploying' ? 'playing' : game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    landbattle: retain(state.landbattle, game),
  }),
  // Spectators receive every identity in the pieces themselves, so god view adds nothing.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (_context, t) => [t('landbattle.rulesDeploy'), t('landbattle.rulesMove'), t('landbattle.rulesBattle'),
      t('landbattle.rulesWin', { n: String(LB_QUIET_LIMIT) })],
    roomContext: () => NO_RULES_OPTION,
    matchContext: () => NO_RULES_OPTION,
  },
  // The move list lives in the board table's panel, and there is no hand to sort.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '⚑' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
