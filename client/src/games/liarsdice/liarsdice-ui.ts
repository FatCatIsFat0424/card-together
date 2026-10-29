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
    // The roll opens a round, the reveal lifts the cups; an elimination keeps its own cue.
    cue: (_game, frame) => {
      if (frame.kind === 'deal') return 'diceRoll';
      if (frame.kind !== 'diceReveal') return undefined;
      return frame.liarsDice?.eliminated ? 'out' : 'diceReveal';
    },
  },
  roundsView: LiarsDiceRounds,
};
