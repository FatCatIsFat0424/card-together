import { lazy } from 'react';
import { identifyCombo } from '@shared/rules/bigtwo';
import type { GameUi } from '../game-ui';
import { BigTwoRounds } from './BigTwoHistory';

export const bigTwoUi: GameUi<'bigtwo'> = {
  gameType: 'bigtwo',
  table: lazy(() => import('./BigTwoTable').then((game) => ({ default: game.BigTwoTable }))),
  presentation: {
    playEffect: (_game, frame) => {
      if (frame.kind !== 'play') return null;
      const combo = identifyCombo(frame.cards);
      if (combo?.type === 'straightFlush') return { kind: 'straightFlush' };
      if (combo?.type === 'fourOfAKind') return { kind: 'bomb' };
      return null;
    },
  },
  roundsView: BigTwoRounds,
};
