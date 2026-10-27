import { lazy } from 'react';
import type { GameUi } from '../game-ui';
import { NinetyNineFrameEffects } from './NinetyNineFrameEffects';
import { NinetyNineRounds } from './NinetyNineHistory';

export const ninetyNineUi: GameUi<'ninetynine'> = {
  gameType: 'ninetynine',
  table: lazy(() => import('./NinetyNineTable').then((game) => ({ default: game.NinetyNineTable }))),
  presentation: {
    // A two-deck match can end with several survivors tied for first.
    summary: (game, t) => game.result && 'winners' in game.result
      ? t('presentation.ninetyNineTied', { seats: game.result.winners.map((seat) => t(`seat.${seat}`)).join(' · ') })
      : '',
    style: { large: true },
    Effects: NinetyNineFrameEffects,
    playEffect: (_game, frame) => {
      const card = frame.cards[0];
      return frame.kind === 'play' && card?.rank === 14 && card.suit === 'spades' ? { kind: 'reset' } : null;
    },
  },
  roundsView: NinetyNineRounds,
};
