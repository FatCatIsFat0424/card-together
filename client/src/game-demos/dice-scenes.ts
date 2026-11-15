import type { DemoScene } from './types';
import type { diceDemoZh } from './dice-i18n';

type AssignedGameType = 'yacht' | 'dominoes' | 'codebreaker';

export const diceDemoScenes: Record<AssignedGameType, readonly DemoScene<keyof typeof diceDemoZh>[]> = {
  yacht: [
    { text: 'yacht-goal', seconds: 7, step: 0 },
    { text: 'yacht-roll', seconds: 7, step: 0, until: 1 },
    { text: 'yacht-hold', seconds: 10, step: 1, until: 3, split: 7 },
    { text: 'yacht-score', seconds: 9, step: 3, until: 4 },
    { text: 'yacht-straight', seconds: 8, step: 4, until: 6 },
    { text: 'yacht-rest', seconds: 14, step: 6, until: 95 },
    { text: 'yacht-end', seconds: 8, step: 95 },
  ],
  dominoes: [
    { text: 'dominoes-goal', seconds: 7, step: 0 },
    { text: 'dominoes-open', seconds: 7, step: 0, until: 1 },
    { text: 'dominoes-match', seconds: 10, step: 1, until: 3 },
    { text: 'dominoes-draw', seconds: 13, step: 3, until: 6, split: 9.5 },
    { text: 'dominoes-rest', seconds: 14, step: 6, until: 28 },
    { text: 'dominoes-out', seconds: 11, step: 28, until: 29 },
    { text: 'dominoes-end', seconds: 8, step: 29 },
  ],
  codebreaker: [
    { text: 'codebreaker-goal', seconds: 7, step: 0 },
    { text: 'codebreaker-guess', seconds: 10, step: 0, until: 2, split: 7 },
    { text: 'codebreaker-feedback', seconds: 9, step: 2 },
    { text: 'codebreaker-next', seconds: 10, step: 2, until: 4, split: 7 },
    { text: 'codebreaker-fast', seconds: 7, step: 4, until: 6 },
    { text: 'codebreaker-solve', seconds: 10, step: 6, until: 8, split: 7 },
    { text: 'codebreaker-rest', seconds: 7, step: 8, until: 9 },
    { text: 'codebreaker-end', seconds: 9, step: 9 },
  ],
};
