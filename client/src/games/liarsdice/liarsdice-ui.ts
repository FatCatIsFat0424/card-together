import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { LiarsDiceFrame } from './LiarsDiceFrame';
import { LiarsDiceRounds } from './LiarsDiceHistory';

export const liarsDiceUi: GameUi<'liarsdice'> = {
  gameType: 'liarsdice',
  table: lazy(() => import('./LiarsDiceTable').then((game) => ({ default: game.LiarsDiceTable }))),
  presentation: {
    style: { large: true },
    heading: (frame) => {
      switch (frame.kind) {
        case 'deal': return 'liarsdice.presentationDeal';
        case 'challenge': return 'liarsdice.presentationChallenge';
        default: return undefined;
      }
    },
    Frame: LiarsDiceFrame,
    // Hook for the dice sound cues that come with the sound packs; only an elimination has one today.
    cue: (_game, frame) => (frame.kind === 'diceReveal' && frame.liarsDice?.eliminated ? 'out' : undefined),
  },
  roundsView: LiarsDiceRounds,
};
