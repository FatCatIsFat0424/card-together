import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { BridgeChip } from './BridgeChip';

export const bridgeUi: GameUi<'bridge'> = {
  gameType: 'bridge',
  table: lazy(() => import('./BridgeTable').then((game) => ({ default: game.BridgeTable }))),
  hudChip: BridgeChip,
  presentation: {
    summary: (game, t) => {
      if (game.phase === 'scoring' && game.result) return t(game.result.declarerTeamWins
        ? 'score.declarerWins' : 'score.defenderWins');
      return game.playing ? `${t('seat.N')} / ${t('seat.S')}: ${game.playing.trickCountNS} · ` +
        `${t('seat.E')} / ${t('seat.W')}: ${game.playing.trickCountEW}` : '';
    },
  },
};
