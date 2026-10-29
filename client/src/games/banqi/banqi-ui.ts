import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { BanqiRoomOptions } from './BanqiRoomOptions';

export const banqiUi: GameUi<'banqi'> = {
  gameType: 'banqi',
  roomOptions: BanqiRoomOptions,
  table: lazy(() => import('./BanqiTable').then((game) => ({ default: game.BanqiTable }))),
  // A blind attack that took nothing only turned the target over.
  boardMoveCue: (move) => (move.capture ? 'capture' : move.revealed !== undefined ? 'flip' : 'place'),
};
