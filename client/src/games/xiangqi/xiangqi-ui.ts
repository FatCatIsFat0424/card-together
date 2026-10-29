import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { XiangqiRoomOptions } from './XiangqiRoomOptions';

export const xiangqiUi: GameUi<'xiangqi'> = {
  gameType: 'xiangqi',
  roomOptions: XiangqiRoomOptions,
  table: lazy(() => import('./XiangqiTable').then((game) => ({ default: game.XiangqiTable }))),
  // A move that gives check sounds as check, even when it also captures.
  boardMoveCue: (move) => (move.check ? 'check' : move.capture ? 'capture' : 'place'),
};
