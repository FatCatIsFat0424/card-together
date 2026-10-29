import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { BattleshipRoomOptions } from './BattleshipRoomOptions';

export const battleshipUi: GameUi<'battleship'> = {
  gameType: 'battleship',
  roomOptions: BattleshipRoomOptions,
  table: lazy(() => import('./BattleshipTable').then((game) => ({ default: game.BattleshipTable }))),
  // A miss sounds as a placement, a hit as a capture, and a sinking as the alert the kit uses for check.
  boardMoveCue: (move) => (move.result === 'sunk' ? 'check' : move.result === 'hit' ? 'capture' : 'place'),
};
