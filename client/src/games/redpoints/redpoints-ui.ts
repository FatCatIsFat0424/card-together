import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { RedPointsRounds } from './RedPointsHistory';

export const redPointsUi: GameUi<'redpoints'> = {
  gameType: 'redpoints',
  table: lazy(() => import('./RedPointsTable').then((game) => ({ default: game.RedPointsTable }))),
  centre: { responsive: true },
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { points, winners } = game.result;
      return t('presentation.redPointsWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${points[seat]}`).join(' · '),
      });
    },
    playEffect: (_game, frame) => {
      if (frame.kind !== 'capture') return null;
      const redCards = frame.cards.filter((item) => item.suit === 'hearts' || item.suit === 'diamonds');
      return redCards.some((item) => item.rank === 14) ? { kind: 'redAce' } : null;
    },
  },
  roundsView: RedPointsRounds,
};
