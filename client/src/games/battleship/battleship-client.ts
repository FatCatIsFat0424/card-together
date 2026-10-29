import { DEFAULT_BATTLESHIP_OPTIONS } from '@shared/rules/battleship';
import type { BattleshipOptions } from '@shared/rules/battleship';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import type { GameRulesContextFields } from '../../game-rules-context';
import { boardResultSummary } from '../board/board-result';

function optionContext(options: BattleshipOptions): GameRulesContextFields {
  return {
    option: { label: 'battleship.noTouching', enabled: options.noTouching },
    moreOptions: [{ label: 'battleship.hitAgain', enabled: options.hitAgain }],
  };
}

export const battleshipClient: ClientGame<'battleship'> = {
  gameType: 'battleship',
  // Placement is simultaneous, so no single seat holds the turn until shooting starts.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'placing' ? 'playing' : game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    battleship: retain(state.battleship, game),
  }),
  // Spectators receive both fleets in the view itself, so god view adds nothing.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => [
      t('battleship.rulesPlace'),
      ...(context?.option?.enabled ? [t('battleship.rulesNoTouching')] : []),
      t('battleship.rulesFire'),
      ...(context?.moreOptions?.some((option) => option.enabled) ? [t('battleship.rulesHitAgain')] : []),
      t('battleship.rulesWin'),
    ],
    roomContext: (room) => optionContext(room.gameOptions?.battleship ?? DEFAULT_BATTLESHIP_OPTIONS),
    matchContext: (game) => optionContext(game.options),
  },
  // The move list lives in the board table's panel, and there is no hand to sort.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '⚓' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
