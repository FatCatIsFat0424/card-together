import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const chessUi: GameUi<'chess'> = {
  gameType: 'chess',
  table: lazy(() => import('./ChessTable').then((game) => ({ default: game.ChessTable }))),
  // A move that gives check sounds as check, even when it also captures.
  boardMoveCue: (move) => (move.check ? 'check' : move.capture ? 'capture' : 'place'),
};
