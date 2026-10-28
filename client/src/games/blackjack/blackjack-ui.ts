import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { BlackjackRoomOptions } from './BlackjackRoomOptions';
import { BlackjackFrame } from './BlackjackFrame';
import { BlackjackRounds } from './BlackjackHistory';

export const blackjackUi: GameUi<'blackjack'> = {
  gameType: 'blackjack',
  roomOptions: BlackjackRoomOptions,
  table: lazy(() => import('./BlackjackTable').then((game) => ({ default: game.BlackjackTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { chips, winners } = game.result;
      return t('presentation.blackjackWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
      });
    },
    heading: (frame) => frame.kind === 'deal' ? 'blackjack.presentationDeal' : undefined,
    Frame: BlackjackFrame,
    ownCards: true,
  },
  roundsView: BlackjackRounds,
};
