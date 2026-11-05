import type { DemoScene } from './types';
import type { trickDemoZh } from './trick-i18n';

type TrickDemoGame = 'hearts' | 'gongzhu' | 'spades';
export const trickDemoScenes: Record<TrickDemoGame, readonly DemoScene<keyof typeof trickDemoZh>[]> = {
  hearts: [
    { text: 'hearts-goal', seconds: 16, step: 0 },
    { text: 'hearts-pass', seconds: 24, step: 0, until: 4 },
    { text: 'hearts-open', seconds: 20, step: 4, until: 8 },
    { text: 'hearts-follow', seconds: 20, step: 8, until: 16 },
    { text: 'hearts-limits', seconds: 20, step: 16 },
    { text: 'hearts-first', seconds: 30, step: 16, until: 56 },
    { text: 'hearts-fast', seconds: 60, step: 56, until: 552 },
    { text: 'hearts-end', seconds: 18, step: 552 },
  ],
  gongzhu: [
    { text: 'gongzhu-goal', seconds: 16, step: 0 },
    { text: 'gongzhu-open', seconds: 20, step: 0, until: 4 },
    { text: 'gongzhu-follow', seconds: 20, step: 4, until: 8 },
    { text: 'gongzhu-points', seconds: 24, step: 8 },
    { text: 'gongzhu-first', seconds: 32, step: 8, until: 52 },
    { text: 'gongzhu-fast', seconds: 60, step: 52, until: 208 },
    { text: 'gongzhu-special', seconds: 20, step: 208 },
    { text: 'gongzhu-end', seconds: 18, step: 208 },
  ],
  spades: [
    { text: 'spades-goal', seconds: 16, step: 0 },
    { text: 'spades-bid', seconds: 24, step: 0, until: 4 },
    { text: 'spades-play', seconds: 20, step: 4, until: 8 },
    { text: 'spades-trump', seconds: 20, step: 8, until: 16 },
    { text: 'spades-score', seconds: 24, step: 16 },
    { text: 'spades-first', seconds: 32, step: 16, until: 56 },
    { text: 'spades-fast', seconds: 60, step: 56, until: 672 },
    { text: 'spades-end', seconds: 18, step: 672 },
  ],
};
