import { lazy } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { GameUi } from '../game-ui';
import { StudFrame } from './StudFrame';
import { StudHud } from './StudHud';
import { StudRounds } from './StudHistory';

export const studUi: GameUi<'stud'> = {
  gameType: 'stud',
  table: lazy(() => import('./StudTable').then((game) => ({ default: game.StudTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { chips, winners } = game.result;
      return t('presentation.holdemWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
      });
    },
    heading: (frame) => frame.kind === 'deal' ? 'stud.presentationDeal'
      : frame.kind === 'street' ? 'stud.presentationStreet' : undefined,
    Frame: StudFrame,
    ownCards: true,
    cue: (game, frame) => {
      if (frame.kind === 'deal' || frame.kind === 'street') return 'card';
      if (frame.kind !== 'award') return undefined;
      const index = frameLogIndex(frame);
      const entry = index === null ? undefined : game.log[index];
      return entry?.type === 'award' && entry.eliminated.length > 0 ? 'out' : undefined;
    },
  },
  roundsView: StudRounds,
  hudInfo: StudHud,
};
