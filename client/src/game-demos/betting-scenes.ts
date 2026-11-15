import type { DemoScene } from './types';
import type { bettingDemoZh } from './betting-i18n';

type AssignedGameType = 'blackjack' | 'holdem' | 'stud' | 'tenhalf';

export const bettingDemoScenes: Record<AssignedGameType, readonly DemoScene<keyof typeof bettingDemoZh>[]> = {
  blackjack: [
    { text: 'blackjack-goal', seconds: 7, step: 0 },
    { text: 'blackjack-bet', seconds: 8, step: 0, until: 1, split: 4.9 },
    { text: 'blackjack-split', seconds: 8, step: 1, until: 2 },
    { text: 'blackjack-fast', seconds: 14, step: 2, until: 8, split: 10.5 },
    { text: 'blackjack-dealer', seconds: 11, step: 8, until: 10, split: 8 },
    { text: 'blackjack-natural', seconds: 8, step: 10, until: 12, split: 5.75 },
    { text: 'blackjack-bust', seconds: 11, step: 12, until: 13, split: 3.5 },
    { text: 'blackjack-end', seconds: 8, step: 13 },
  ],
  holdem: [
    { text: 'holdem-goal', seconds: 7, step: 0, split: 3.5 },
    { text: 'holdem-call', seconds: 8, step: 0, until: 1 },
    { text: 'holdem-flop', seconds: 9, step: 1, until: 5, split: 4.9 },
    { text: 'holdem-bet', seconds: 8, step: 5, until: 6 },
    { text: 'holdem-fast', seconds: 9, step: 6, until: 11, split: 4.6 },
    { text: 'holdem-showdown', seconds: 11, step: 11, until: 12, split: 4.3 },
    { text: 'holdem-allin', seconds: 9, step: 12, until: 16, split: 6.25 },
    { text: 'holdem-sidepot', seconds: 11, step: 16, until: 17, split: 4.3 },
    { text: 'holdem-end', seconds: 8, step: 17 },
  ],
  stud: [
    { text: 'stud-goal', seconds: 8, step: 0, split: 4 },
    { text: 'stud-bet', seconds: 9, step: 0, until: 1 },
    { text: 'stud-fast', seconds: 9, step: 1, until: 4, split: 3.5 },
    { text: 'stud-raise', seconds: 11, step: 4, until: 6, split: 7.25 },
    { text: 'stud-allin', seconds: 9, step: 6, until: 7 },
    { text: 'stud-showdown', seconds: 11, step: 7, until: 8, split: 3.5 },
    { text: 'stud-end', seconds: 8, step: 8 },
  ],
  tenhalf: [
    { text: 'tenhalf-goal', seconds: 7, step: 0 },
    { text: 'tenhalf-bet', seconds: 8, step: 0, until: 1, split: 5 },
    { text: 'tenhalf-hit', seconds: 8, step: 1, until: 2 },
    { text: 'tenhalf-settle', seconds: 11, step: 2, until: 3, split: 3.5 },
    { text: 'tenhalf-fast', seconds: 14, step: 3, until: 15, split: 6.1 },
    { text: 'tenhalf-bust', seconds: 11, step: 15, until: 16, split: 4.3 },
    { text: 'tenhalf-end', seconds: 8, step: 16 },
  ],
};
