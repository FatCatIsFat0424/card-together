import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { CodeBreakerRoomOptions } from './CodeBreakerRoomOptions';

export const codeBreakerUi: GameUi<'codebreaker'> = {
  gameType: 'codebreaker',
  roomOptions: CodeBreakerRoomOptions,
  table: lazy(() => import('./CodeBreakerTable').then((game) => ({ default: game.CodeBreakerTable }))),
  // A resolved round sounds once, and only for the viewer's own guess; other seats' guesses stay silent.
  boardMoveCue: (move, game) => (move.seat === game.mySeat && game.observer !== 'spectator' ? 'place' : null),
};
