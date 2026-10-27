import { lazy } from 'react';
import { frameLogIndex } from '@shared/game-presentation';
import type { GameUi } from '../game-ui';
import { HoldemFrame } from './HoldemFrame';
import { HoldemHud } from './HoldemHud';
import { HoldemRounds } from './HoldemHistory';

export const holdemUi: GameUi<'holdem'> = {
  gameType: 'holdem',
  table: lazy(() => import('./HoldemTable').then((game) => ({ default: game.HoldemTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { chips, winners } = game.result;
      return t('presentation.holdemWinners', {
        scores: winners.map((seat) => `${t(`seat.${seat}`)} ${chips[seat]}`).join(' · '),
      });
    },
    heading: (frame) => frame.kind === 'deal' ? 'holdem.presentationDeal' : undefined,
    Frame: HoldemFrame,
    ownCards: true,
    cue: (game, frame) => {
      if (frame.kind === 'deal') return 'card';
      // An award frame that knocks a seat out of the match
      if (frame.kind !== 'award') return undefined;
      const index = frameLogIndex(frame);
      const entry = index === null ? undefined : game.log[index];
      return entry?.type === 'award' && entry.eliminated.length > 0 ? 'out' : undefined;
    },
  },
  roundsView: HoldemRounds,
  hudInfo: HoldemHud,
};
