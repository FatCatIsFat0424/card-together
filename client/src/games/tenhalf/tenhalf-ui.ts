import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { TenHalfFrame } from './TenHalfFrame';
import { TenHalfRounds } from './TenHalfHistory';

export const tenHalfUi: GameUi<'tenhalf'> = {
  gameType: 'tenhalf',
  table: lazy(() => import('./TenHalfTable').then((game) => ({ default: game.TenHalfTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { chips, winners } = game.result;
      return t('presentation.tenhalfWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
      });
    },
    heading: (frame) => frame.kind === 'deal' ? 'tenhalf.presentationDeal' : undefined,
    Frame: TenHalfFrame,
    ownCards: true,
  },
  roundsView: TenHalfRounds,
};
