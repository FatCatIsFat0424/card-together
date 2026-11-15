import type { DemoScene } from './types';
import type { trickDemoZh } from './trick-i18n';

type TrickDemoGame = 'hearts' | 'gongzhu' | 'spades';
export const trickDemoScenes: Record<TrickDemoGame, readonly DemoScene<keyof typeof trickDemoZh>[]> = {
  hearts: [
    { text: 'hearts-goal', seconds: 7, step: 0 },
    { text: 'hearts-pass', seconds: 15, step: 0, until: 4, split: 9.25 },
    { text: 'hearts-follow', seconds: 14, step: 4, until: 8, split: 8.75 },
    { text: 'hearts-lead', seconds: 14, step: 8, until: 12, split: 8.75 },
    { text: 'hearts-fast', seconds: 26, step: 12, until: 552 },
    { text: 'hearts-end', seconds: 9, step: 552 },
  ],
  gongzhu: [
    { text: 'gongzhu-goal', seconds: 8, step: 0 },
    { text: 'gongzhu-open', seconds: 14, step: 0, until: 4, split: 6.1 },
    { text: 'gongzhu-take', seconds: 14, step: 4, until: 8, split: 8.75 },
    { text: 'gongzhu-fast', seconds: 20, step: 8, until: 208, split: 7.1 },
    { text: 'gongzhu-end', seconds: 9, step: 208 },
  ],
  spades: [
    { text: 'spades-goal', seconds: 7, step: 0 },
    { text: 'spades-bid', seconds: 14, step: 0, until: 4, split: 6.1 },
    { text: 'spades-play', seconds: 8, step: 4, until: 20 },
    { text: 'spades-trump', seconds: 14, step: 20, until: 24, split: 6.1 },
    { text: 'spades-fast', seconds: 30, step: 24, until: 672, split: 15 },
    { text: 'spades-end', seconds: 9, step: 672 },
  ],
};
