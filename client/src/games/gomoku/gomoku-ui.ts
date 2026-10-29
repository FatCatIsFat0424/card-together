import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { GomokuRoomOptions } from './GomokuRoomOptions';

export const gomokuUi: GameUi<'gomoku'> = {
  gameType: 'gomoku',
  roomOptions: GomokuRoomOptions,
  table: lazy(() => import('./GomokuTable').then((game) => ({ default: game.GomokuTable }))),
};
