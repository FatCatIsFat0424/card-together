import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { DominoesFrame } from './DominoesFrame';
import { DominoesRounds } from './DominoesHistory';
import { DominoesRoomOptions } from './DominoesRoomOptions';

export const dominoesUi: GameUi<'dominoes'> = {
  gameType: 'dominoes',
  roomOptions: DominoesRoomOptions,
  table: lazy(() => import('./DominoesTable').then((game) => ({ default: game.DominoesTable }))),
  // The line fills the table centre and scales its tiles to the space.
  centre: { responsive: true },
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { scores, winners } = game.result;
      return t('presentation.dominoesWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${scores[seat]}`).join(' · '),
      });
    },
    style: { large: true },
    heading: (frame) => frame.kind === 'deal' ? 'dominoes.presentationDeal'
      : frame.kind === 'settle' ? 'dominoes.presentationRoundEnd' : undefined,
    Frame: DominoesFrame,
    cue: (_game, frame) => (frame.kind === 'deal' ? 'card' : undefined),
  },
  roundsView: DominoesRounds,
};
