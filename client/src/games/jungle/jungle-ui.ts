import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const jungleUi: GameUi<'jungle'> = {
  gameType: 'jungle',
  table: lazy(() => import('./JungleTable').then((game) => ({ default: game.JungleTable }))),
  boardMoveCue: (move) => (move.capture ? 'capture' : 'place'),
};
