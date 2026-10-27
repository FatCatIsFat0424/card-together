import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { LiarsDeckFrame } from './LiarsDeckFrame';
import { LiarsDeckRounds } from './LiarsDeckHistory';

export const liarsDeckUi: GameUi<'liarsdeck'> = {
  gameType: 'liarsdeck',
  table: lazy(() => import('./LiarsDeckTable').then((game) => ({ default: game.LiarsDeckTable }))),
  presentation: { Frame: LiarsDeckFrame },
  roundsView: LiarsDeckRounds,
};
