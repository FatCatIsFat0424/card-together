import { DEFAULT_BANQI_OPTIONS } from '@shared/banqi-options';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';
import type { GameRulesContextFields } from '../../game-rules-context';
import type { BanqiOptions } from '@shared/games/banqi/types';

function context(options: BanqiOptions): GameRulesContextFields {
  return {
    option: { label: 'banqi.chain', enabled: options.chain },
    moreOptions: [{ label: 'banqi.rookDash', enabled: options.rookDash }],
  };
}

export const banqiClient: ClientGame<'banqi'> = {
  gameType: 'banqi',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    banqi: retain(state.banqi, game),
  }),
  // God view travels inside the visible state (`observedPieces`), so there is nothing extra to keep here.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (ctx, t) => [t('banqi.rulesTurn'), t('banqi.rulesRank'), t('banqi.rulesCannon'),
      ...(ctx?.option?.enabled ? [t('banqi.rulesChain')] : []),
      ...(ctx?.moreOptions?.some((option) => option.enabled) ? [t('banqi.rulesRookDash')] : [])],
    roomContext: (room) => context(room.gameOptions?.banqi ?? DEFAULT_BANQI_OPTIONS),
    matchContext: (game) => context(game.options),
  },
  // The move list lives in the board table's panel, and there is no hand to sort.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '暗' },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
