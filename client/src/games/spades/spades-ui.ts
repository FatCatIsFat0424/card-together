import { lazy } from 'react';
import type { GameUi } from '../game-ui';

export const spadesUi: GameUi<'spades'> = {
  gameType: 'spades', table: lazy(() => import('./SpadesTable').then((game) => ({ default: game.SpadesTable }))),
  presentation: {
    summary: (game, t) => `${t('table.teamNS')} ${game.scores.NS} · ${t('table.teamEW')} ${game.scores.EW}`,
    cue: (_game, frame) => frame.kind === 'play' || frame.kind === 'deal' ? 'card' : undefined,
  },
};
