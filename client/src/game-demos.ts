import { boardsDemoScenes } from './game-demos/boards-scenes';
import { cardsDemoScenes } from './game-demos/cards-scenes';
import { trickDemoScenes } from './game-demos/trick-scenes';
import { bettingDemoScenes } from './game-demos/betting-scenes';
import { diceDemoScenes } from './game-demos/dice-scenes';
import type { GameType } from '@shared/types';
import recordings from './game-demo-recordings.json';
import type { DemoTextKey } from './game-demo-i18n';
import type { DemoScene as SharedDemoScene } from './game-demos/types';

export const DEMO_GAME_TYPES = ['bridge', 'napoleon', 'chinesepoker', 'liarsdice', 'blackjack', 'holdem', 'stud', 'tenhalf', 'reversi', 'gomoku', 'go', 'xiangqi', 'chess', 'jungle', 'landbattle', 'battleship', 'banqi', 'chinesecheckers', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'crazyeights', 'oldmaid', 'gofish', 'doudizhu', 'liarsdeck', 'hearts', 'gongzhu', 'spades', 'yacht', 'dominoes', 'codebreaker'] as const;
export type DemoGameType = typeof DEMO_GAME_TYPES[number];
/** `starts` lists the video second where each scene begins; placeholders without a take omit it. */
interface DemoRecording { readonly leadIn: number; readonly duration: number; readonly starts?: readonly number[] }
/** Measured from the owner's recordings, including their opening delay and final reading time; `npm run demos:import` checks durations. */
export const DEMO_RECORDINGS: Record<DemoGameType, DemoRecording> = recordings;
export type DemoScene = SharedDemoScene<DemoTextKey>;
export const DEMO_SCENES: Record<DemoGameType, readonly DemoScene[]> = {
  ...bettingDemoScenes,
  ...boardsDemoScenes,
  ...cardsDemoScenes,
  ...trickDemoScenes,
  ...diceDemoScenes,
  bridge: [
    { text: 'bridge-goal', seconds: 6, step: 0 },
    { text: 'bridge-bid', seconds: 14, step: 0, until: 3, split: 7 },
    { text: 'bridge-contract', seconds: 6, step: 3, until: 6 },
    { text: 'bridge-follow', seconds: 14, step: 6, until: 10 },
    { text: 'bridge-lead', seconds: 7, step: 10, until: 18 },
    { text: 'bridge-trump', seconds: 10, step: 18, until: 22 },
    { text: 'bridge-rest', seconds: 13, step: 22, until: 58 },
    { text: 'bridge-end', seconds: 8, step: 58 },
  ],
  napoleon: [
    { text: 'napoleon-goal', seconds: 7, step: 0 },
    { text: 'napoleon-bid', seconds: 14, step: 0, until: 4 },
    { text: 'napoleon-discard', seconds: 9, step: 4, until: 5 },
    { text: 'napoleon-review', seconds: 5, step: 5, until: 8 },
    { text: 'napoleon-secretary', seconds: 9, step: 8, until: 9 },
    { text: 'napoleon-summon', seconds: 15, step: 9, until: 13, split: 6.5 },
    { text: 'napoleon-rest', seconds: 15, step: 13, until: 61 },
    { text: 'napoleon-end', seconds: 8, step: 61 },
  ],
  chinesepoker: [
    { text: 'cp-goal', seconds: 7, step: 0 },
    { text: 'cp-front', seconds: 7, step: 0, interaction: 'front' },
    { text: 'cp-middle', seconds: 8, step: 0, interaction: 'middle' },
    { text: 'cp-back', seconds: 8, step: 0, interaction: 'back' },
    { text: 'cp-submit', seconds: 9, step: 0, until: 3 },
    { text: 'cp-reveal', seconds: 10, step: 3, until: 4 },
    { text: 'cp-bonus', seconds: 8, step: 4 },
    { text: 'cp-end', seconds: 8, step: 4 },
  ],
  liarsdice: [
    { text: 'dice-goal', seconds: 7, step: 0 },
    { text: 'dice-bid', seconds: 9, step: 0, until: 1 },
    { text: 'dice-open', seconds: 13, step: 1, until: 2, split: 3.5 },
    { text: 'dice-next', seconds: 10, step: 2, until: 6 },
    { text: 'dice-raise', seconds: 14, step: 6, until: 9 },
    { text: 'dice-rest', seconds: 12, step: 9, until: 18 },
    { text: 'dice-end', seconds: 8, step: 18 },
  ],
};

export function isDemoGameType(game: GameType): game is DemoGameType {
  return DEMO_GAME_TYPES.some((candidate) => candidate === game);
}
