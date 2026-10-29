import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const reversiUi: GameUi<'reversi'> = {
  gameType: 'reversi',
  table: lazy(() => import('./ReversiTable').then((game) => ({ default: game.ReversiTable }))),
  // A pass changes nothing on the board.
  boardMoveCue: (move) => (move.to === undefined ? null : 'place'),
};
