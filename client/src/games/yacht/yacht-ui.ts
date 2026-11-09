import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { YachtRoomOptions } from './YachtRoomOptions';

export const yachtUi: GameUi<'yacht'> = {
  gameType: 'yacht',
  roomOptions: YachtRoomOptions,
  table: lazy(() => import('./YachtTable').then((game) => ({ default: game.YachtTable }))),
  // The scorecard fills the centre, so it sizes itself instead of being scaled to fit.
  centre: { responsive: true },
};
