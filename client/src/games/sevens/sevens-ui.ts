import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { SevensRounds } from './SevensHistory';

export const sevensUi: GameUi<'sevens'> = {
  gameType: 'sevens',
  table: lazy(() => import('./SevensTable').then((game) => ({ default: game.SevensTable }))),
  centre: { wide: true },
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { penalties, winners } = game.result;
      return t('presentation.sevensWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${penalties[seat]}`).join(' · '),
      });
    },
    style: { large: true, bigCard: true },
  },
  roundsView: SevensRounds,
};
