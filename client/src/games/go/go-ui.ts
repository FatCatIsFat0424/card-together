import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { GoRoomOptions } from './GoRoomOptions';

export const goUi: GameUi<'go'> = {
  gameType: 'go',
  roomOptions: GoRoomOptions,
  table: lazy(() => import('./GoTable').then((game) => ({ default: game.GoTable }))),
};
