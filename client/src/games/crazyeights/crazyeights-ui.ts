import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { CrazyEightsRoomOptions } from './CrazyEightsRoomOptions';
import { CrazyEightsFrameEffects } from './CrazyEightsFrame';
import { CrazyEightsRounds } from './CrazyEightsHistory';

export const crazyEightsUi: GameUi<'crazyeights'> = {
  gameType: 'crazyeights',
  roomOptions: CrazyEightsRoomOptions,
  table: lazy(() => import('./CrazyEightsTable').then((game) => ({ default: game.CrazyEightsTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { scores, winners } = game.result;
      return t('presentation.crazyEightsWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${scores[seat]}`).join(' · '),
      });
    },
    style: { large: true },
    heading: (frame) => frame.kind === 'deal' ? 'crazyeights.presentationDeal'
      : frame.kind === 'hit' ? 'crazyeights.presentationDraw'
        : frame.kind === 'settle' ? 'crazyeights.presentationHandEnd' : undefined,
    Effects: CrazyEightsFrameEffects,
    cue: (_game, frame) => (frame.kind === 'deal' ? 'card' : undefined),
  },
  roundsView: CrazyEightsRounds,
};
