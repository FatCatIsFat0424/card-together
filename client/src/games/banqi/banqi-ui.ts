import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { BanqiRoomOptions } from './BanqiRoomOptions';

export const banqiUi: GameUi<'banqi'> = {
  gameType: 'banqi',
  roomOptions: BanqiRoomOptions,
  table: lazy(() => import('./BanqiTable').then((game) => ({ default: game.BanqiTable }))),
  boardMoveCue: (move) => (move.revealed !== undefined ? 'flip' : move.capture ? 'capture' : 'place'),
};
