import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { GoFishFrame } from './GoFishFrame';
import { GoFishRounds } from './GoFishHistory';

export const goFishUi: GameUi<'gofish'> = {
  gameType: 'gofish',
  table: lazy(() => import('./GoFishTable').then((game) => ({ default: game.GoFishTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { scores, winners } = game.result;
      return t('presentation.goFishWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${scores[seat]}`).join(' · '),
      });
    },
    style: { large: true },
    heading: (frame) => frame.kind === 'deal' ? 'gofish.presentationDeal'
      : frame.kind === 'play' ? 'gofish.presentationAsk'
        : frame.kind === 'award' ? 'gofish.presentationBook'
          : frame.kind === 'hit' ? 'gofish.presentationDraw'
            : frame.kind === 'settle' ? 'gofish.presentationHandEnd' : undefined,
    Frame: GoFishFrame,
    cue: (_game, frame) => (frame.kind === 'deal' || frame.kind === 'award' ? 'card' : undefined),
  },
  roundsView: GoFishRounds,
};
