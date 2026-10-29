import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const landBattleUi: GameUi<'landbattle'> = {
  gameType: 'landbattle',
  table: lazy(() => import('./LandBattleTable').then((game) => ({ default: game.LandBattleTable }))),
  // A battle sounds as a capture whatever its outcome; a plain move as a placement.
  boardMoveCue: (move) => (move.battle ? 'capture' : 'place'),
};
