import { DEFAULT_GO_OPTIONS, GO_HANDICAP_KOMI, GO_KOMI } from '@shared/rules/go';
import type { GoOptions } from '@shared/rules/go';
import type { GameRulesContextFields } from '../../game-rules-context';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardReasonLabel } from '../board/board-result';

function optionContext(options: GoOptions): GameRulesContextFields {
  return { option: { label: 'go.handicap', enabled: options.handicap > 0 }, goOptions: options };
}

export const goClient: ClientGame<'go'> = {
  gameType: 'go',
  // Marking dead stones is a joint decision, so no single seat holds the turn until play resumes.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase === 'marking' ? 'playing' : game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    go: retain(state.go, game),
  }),
  // The whole position is public, so there is nothing extra for observers to see.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => {
      const handicap = context?.goOptions?.handicap ?? 0;
      return [t('go.rulesGoal'),
        handicap > 0 ? t('go.rulesHandicap', { n: String(handicap), komi: String(GO_HANDICAP_KOMI) })
          : t('go.rulesScore', { komi: String(GO_KOMI) }),
        t('go.rulesKo'), t('go.rulesEnd')];
    },
    roomContext: (room) => optionContext(room.gameOptions?.go ?? DEFAULT_GO_OPTIONS),
    matchContext: (game) => optionContext(game.options),
  },
  // The move list lives in the board table's panel, so there are no rounds to list.
  // There is no hand to sort; the board table never shows the sort tools.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '◉' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => ({
      kind: 'winners',
      winners: result.winners,
      suffix: ` · ${result.reason === 'resign' ? boardReasonLabel(result, t) : t('go.resultMargin', { n: String(result.margin) })}`,
    }),
  },
};
