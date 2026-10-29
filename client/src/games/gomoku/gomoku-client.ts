import { DEFAULT_GOMOKU_OPTIONS } from '@shared/rules/gomoku';
import type { GomokuOptions } from '@shared/rules/gomoku';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import type { GameRulesContextFields } from '../../game-rules-context';
import { boardResultSummary } from '../board/board-result';

function optionContext(options: GomokuOptions): GameRulesContextFields {
  return {
    option: { label: 'gomoku.renju', enabled: options.renju },
    moreOptions: [{ label: 'gomoku.swap', enabled: options.swap }],
  };
}

export const gomokuClient: ClientGame<'gomoku'> = {
  gameType: 'gomoku',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    gomoku: retain(state.gomoku, game),
  }),
  // The whole position is public, so there is nothing extra for observers to see.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => [
      t('gomoku.rulesFive'),
      ...(context?.option?.enabled ? [t('gomoku.rulesRenju')] : []),
      ...(context?.moreOptions?.some((option) => option.enabled) ? [t('gomoku.rulesSwap')] : []),
      t('gomoku.rulesDraw'),
    ],
    roomContext: (room) => optionContext(room.gameOptions?.gomoku ?? DEFAULT_GOMOKU_OPTIONS),
    matchContext: (game) => optionContext(game.options),
  },
  // The move list lives in the board table's panel, so there are no rounds to list.
  // There is no hand to sort; the board table never shows the sort tools.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '⚪' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
