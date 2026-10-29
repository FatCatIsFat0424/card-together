import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const reversiUi: GameUi<'reversi'> = {
  gameType: 'reversi',
  table: lazy(() => import('./ReversiTable').then((game) => ({ default: game.ReversiTable }))),
};
