import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { HeartsFrame } from './HeartsFrame';
export const heartsUi: GameUi<'hearts'> = {
  gameType: 'hearts',
  table: lazy(() => import('./HeartsTable').then((module) => ({ default: module.HeartsTable }))),
  presentation: {
    Frame: HeartsFrame,
    heading: (frame) => frame.kind === 'settle' ? 'hearts.handEnd' : undefined,
    cue: (_game, frame) => frame.kind === 'deal' ? 'card' : undefined,
    summary: (game, t) => game.result ? t('hearts.winners', { names: game.result.winners.map((seat) => t(`seat.${seat}`)).join(' · ') }) : '',
  },
};
