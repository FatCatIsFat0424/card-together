import { DEFAULT_YACHT_OPTIONS } from '@shared/rules/yacht';
import type { YachtOptions } from '@shared/rules/yacht';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import type { GameRulesContextFields } from '../../game-rules-context';

function optionContext(options: YachtOptions): GameRulesContextFields {
  return { option: { label: 'yacht.rulesSimultaneous', enabled: options.mode === 'simultaneous' } };
}

export const yachtClient: ClientGame<'yacht'> = {
  gameType: 'yacht',
  // Simultaneous rounds have no single seat on turn.
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    yacht: retain(state.yacht, game),
  }),
  // Dice and scorecards are public, so god view adds nothing.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (_context, t) => [t('yacht.rulesRoll'), t('yacht.rulesBoxes'), t('yacht.rulesBonus'), t('yacht.rulesWin')],
    roomContext: (room) => optionContext(room.gameOptions?.yacht ?? DEFAULT_YACHT_OPTIONS),
    matchContext: (game) => optionContext(game.options),
  },
  // Dice are shown in the order they were rolled, so the table tools omit sorting.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank', unsortable: true },
  handBeside: false,
  lobbyIcon: { glyph: '⛵' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, mySeat) => ({
      kind: 'winners',
      winners: result.winners,
      detail: mySeat && result.seats.includes(mySeat) ? { key: 'history.score', n: String(result.totals[mySeat] ?? 0) } : null,
    }),
  },
};
