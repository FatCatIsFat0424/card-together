import { lazy } from 'react';
import type { Seat } from '@shared/types';
import type { GameUi } from '../game-ui';
import { ChinesePokerReveal } from './ChinesePokerReveal';

export const chinesePokerUi: GameUi<'chinesepoker'> = {
  gameType: 'chinesepoker',
  table: lazy(() => import('./ChinesePokerTable').then((game) => ({ default: game.ChinesePokerTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { scores, winners } = game.result;
      return t('presentation.chinesePokerWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${scores[seat] > 0 ? '+' : ''}${scores[seat]}`).join(' · '),
      });
    },
    // A showdown row compares all four seats at once, which needs its own layout.
    takeover: (frame, bottomSeat) => frame.kind === 'reveal' && frame.row
      ? <ChinesePokerReveal key={frame.key} row={frame.row} bottomSeat={bottomSeat as Seat} /> : null,
  },
};
