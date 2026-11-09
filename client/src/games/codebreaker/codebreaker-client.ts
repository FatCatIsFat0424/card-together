import { DEFAULT_CODEBREAKER_OPTIONS } from '@shared/rules/codebreaker';
import type { CodeBreakerOptions } from '@shared/rules/codebreaker';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import type { GameRulesContextFields } from '../../game-rules-context';

function optionContext(options: CodeBreakerOptions): GameRulesContextFields {
  return { option: { label: 'codebreaker.optionColors', enabled: options.variant === 'colors' } };
}

export const codeBreakerClient: ClientGame<'codebreaker'> = {
  gameType: 'codebreaker',
  // Every active seat guesses at once, so no single seat holds the turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: null,
    codebreaker: retain(state.codebreaker, game),
  }),
  // Spectators receive the secret and every history in the view itself, so god view adds nothing.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => [
      t('codebreaker.rulesSecret'),
      t(context?.option?.enabled ? 'codebreaker.rulesColors' : 'codebreaker.rulesDigits'),
      t('codebreaker.rulesRounds'),
      t('codebreaker.rulesWin'),
    ],
    roomContext: (room) => optionContext(room.gameOptions?.codebreaker ?? DEFAULT_CODEBREAKER_OPTIONS),
    matchContext: (game) => optionContext(game.options),
  },
  // There is no hand to sort.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank', unsortable: true },
  handBeside: false,
  lobbyIcon: { glyph: '🔐' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => {
      if (result.winners.length === 0) return { kind: 'text', text: t('codebreaker.noWinner') };
      return { kind: 'winners', winners: result.winners,
        suffix: t('codebreaker.summaryGuesses', { n: String(result.guesses[result.winners[0]] ?? 0) }) };
    },
  },
};
