import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';
import type { GameRulesContextFields } from '../../game-rules-context';
import type { BanqiMatchOptions } from '@shared/games/banqi/types';
import { DEFAULT_BANQI_OPTIONS, LEGACY_BANQI_OPTIONS, banqiMatchOptions, banqiRules } from '@shared/banqi-options';

function context(options: BanqiMatchOptions): GameRulesContextFields {
  const rules = banqiRules(options);
  return {
    // Matches started before blind attacks existed chained captures of face-up pieces only.
    option: { label: rules.chain && !rules.blindCapture ? 'banqi.chainFaceUp' : 'banqi.chain', enabled: rules.chain },
    moreOptions: [{ label: 'banqi.rookDash', enabled: rules.rookDash }],
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
    summary: (ctx, t) => {
      // The lobby has no room, so it describes a new room's defaults.
      const fields = ctx ?? context(banqiMatchOptions(DEFAULT_BANQI_OPTIONS));
      return [t('banqi.rulesTurn'), t('banqi.rulesRank'), t('banqi.rulesCannon'),
        ...(fields.option?.enabled ? [t('banqi.rulesChain')] : []),
        ...(fields.option?.enabled && fields.option.label === 'banqi.chain' ? [t('banqi.rulesBlind')] : []),
        ...(fields.moreOptions?.some((option) => option.label === 'banqi.rookDash' && option.enabled)
          ? [t('banqi.rulesRookDash')] : [])];
    },
    roomContext: (room) => context(banqiMatchOptions(room.gameOptions?.banqi ?? LEGACY_BANQI_OPTIONS)),
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
