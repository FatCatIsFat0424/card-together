import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const chineseCheckersUi: GameUi<'chinesecheckers'> = {
  gameType: 'chinesecheckers',
  table: lazy(() => import('./ChineseCheckersTable').then((game) => ({ default: game.ChineseCheckersTable }))),
  // Passes and resignations change nothing on the board; marbles never capture.
  boardMoveCue: (move) => (move.to === undefined ? null : 'place'),
};
