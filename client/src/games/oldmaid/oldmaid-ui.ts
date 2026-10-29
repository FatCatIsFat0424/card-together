import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { OldMaidFrame } from './OldMaidFrame';
import { OldMaidRounds } from './OldMaidHistory';

export const oldMaidUi: GameUi<'oldmaid'> = {
  gameType: 'oldmaid',
  table: lazy(() => import('./OldMaidTable').then((game) => ({ default: game.OldMaidTable }))),
  presentation: {
    summary: (game, t) => {
      if (!game.result) return '';
      const { totals, winners } = game.result;
      return winners.map((seat) => `${t(`seat.${seat}`)} ${t('oldmaid.points', { n: String(totals[seat]) })}`).join(' · ');
    },
    heading: (frame) => {
      switch (frame.kind) {
        case 'deal': return 'oldmaid.presentationDeal';
        case 'draw': return 'oldmaid.presentationDraw';
        case 'settle': return 'oldmaid.presentationSettle';
        default: return undefined;
      }
    },
    Frame: OldMaidFrame,
    cue: (_game, frame) => (frame.kind === 'draw' || frame.kind === 'deal' ? 'card' : undefined),
  },
  roundsView: OldMaidRounds,
};
