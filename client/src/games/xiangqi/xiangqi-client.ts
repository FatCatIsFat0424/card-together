import type { XiangqiOptions } from '@shared/types';
import { DEFAULT_XIANGQI_OPTIONS } from '@shared/xiangqi-options';
import type { GameRulesContextFields } from '../../game-rules-context';
import type { ClientGame } from '../client-game';
import { STANDARD_HAND_ORDER } from '../client-game-helpers';
import { boardResultSummary } from '../board/board-result';

function handicapContext(options: XiangqiOptions): GameRulesContextFields {
  return { option: { label: 'xiangqi.handicap', enabled: options.handicap !== 'none' }, xiangqiHandicap: options };
}

export const xiangqiClient: ClientGame<'xiangqi'> = {
  gameType: 'xiangqi',
  restoreSnapshot: (game, { state, retain }) => ({
    phase: game.phase,
    currentTurnSeat: game.phase === 'playing' ? game.currentTurnSeat : null,
    xiangqi: retain(state.xiangqi, game),
  }),
  // The whole position is public, so there is nothing extra for observers to see.
  observedView: () => ({}),
  spectatorPatch: () => ({}),
  rules: {
    summary: (context, t) => {
      const handicap = context?.xiangqiHandicap;
      return [t('xiangqi.rulesGoal'), t('xiangqi.rulesRepeat'), t('xiangqi.rulesQuiet'),
        ...handicap && handicap.handicap !== 'none' ? [t('xiangqi.rulesHandicap', {
          side: t(handicap.handicapSide === 'red' ? 'xiangqi.redSide' : 'xiangqi.blackSide'),
          pieces: t(`xiangqi.handicapPieces.${handicap.handicap}`),
        })] : []];
    },
    roomContext: (room) => handicapContext(room.gameOptions?.xiangqi ?? DEFAULT_XIANGQI_OPTIONS),
    matchContext: (game) => handicapContext(game.options),
  },
  // The move list lives in the board table's panel, so there are no rounds to list.
  // There is no hand to sort; the board table never shows the sort tools.
  handSort: { order: STANDARD_HAND_ORDER, bySuit: false, initial: 'rank' },
  handBeside: false,
  lobbyIcon: { glyph: '帥', red: true },
  settlement: (game) => game.result,
  result: {
    winners: (result) => result.winners,
    sidesWin: false,
    summary: (result, _mySeat, t) => boardResultSummary(result, t),
  },
};
