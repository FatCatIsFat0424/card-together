import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { GongZhuFrame, GongZhuRounds } from './GongZhuHistory';

export const gongZhuUi: GameUi<'gongzhu'> = {
  gameType: 'gongzhu',
  table: lazy(() => import('./GongZhuTable').then((game) => ({ default: game.GongZhuTable }))),
  presentation: { Frame: GongZhuFrame, cue: (_game, frame) => frame.kind === 'deal' ? 'card' : undefined },
  roundsView: GongZhuRounds,
};
