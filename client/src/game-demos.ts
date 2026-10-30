import { boardsDemoScenes } from './game-demos/boards-scenes';
import { cardsDemoScenes } from './game-demos/cards-scenes';
import { bettingDemoScenes } from './game-demos/betting-scenes';
import type { GameType } from '@shared/types';
import recordings from './game-demo-recordings.json';
import type { DemoTextKey } from './game-demo-i18n';
import type { DemoScene as SharedDemoScene } from './game-demos/types';

export const DEMO_GAME_TYPES = ['bridge', 'napoleon', 'chinesepoker', 'liarsdice', 'blackjack', 'holdem', 'stud', 'tenhalf', 'reversi', 'gomoku', 'xiangqi', 'jungle', 'landbattle', 'battleship', 'banqi', 'chinesecheckers', 'bigtwo', 'redpoints', 'ninetynine', 'sevens', 'crazyeights', 'oldmaid', 'gofish', 'doudizhu', 'liarsdeck'] as const;
export type DemoGameType = typeof DEMO_GAME_TYPES[number];
interface DemoRecording { readonly leadIn: number; readonly duration: number; readonly chapters?: readonly number[] }
/** Measured from the owner's recordings, including their opening delay and final reading time; `npm run demos:import` checks durations. */
export const DEMO_RECORDINGS: Record<DemoGameType, DemoRecording> = recordings;
export type DemoScene = SharedDemoScene<DemoTextKey>;
function withIntroduction<K extends string>(courses: Record<K, readonly DemoScene[]>): Record<K, readonly DemoScene[]> {
  const introduction: DemoScene = { text: 'start', seconds: 14, step: 0 };
  return Object.fromEntries(Object.keys(courses).map((game) =>
    [game, [introduction, ...courses[game as K]]])) as unknown as Record<K, readonly DemoScene[]>;
}
export const DEMO_SCENES: Record<DemoGameType, readonly DemoScene[]> = {
  ...withIntroduction(bettingDemoScenes),
  ...withIntroduction(boardsDemoScenes),
  ...withIntroduction(cardsDemoScenes),
  bridge: [
    { text: 'start', seconds: 14, step: 0 },
    { text: 'bridge-goal', seconds: 14, step: 0 },
    { text: 'bridge-redeal', seconds: 14, step: 0, until: 2 },
    { text: 'bridge-bid', seconds: 18, step: 2, until: 3 },
    { text: 'bridge-contract', seconds: 12, step: 3, until: 6 },
    { text: 'bridge-follow', seconds: 40, step: 6, until: 18 },
    { text: 'bridge-trump', seconds: 18, step: 18, until: 22 },
    { text: 'bridge-rest', seconds: 62, step: 22, until: 58 },
    { text: 'bridge-end', seconds: 18, step: 58 },
  ],
  napoleon: [
    { text: 'start', seconds: 14, step: 0 },
    { text: 'napoleon-goal', seconds: 16, step: 0 },
    { text: 'napoleon-bid', seconds: 18, step: 0, until: 4 },
    { text: 'napoleon-discard', seconds: 18, step: 4, until: 5 },
    { text: 'napoleon-review', seconds: 12, step: 5, until: 8 },
    { text: 'napoleon-secretary', seconds: 18, step: 8, until: 9 },
    { text: 'napoleon-summon', seconds: 20, step: 9, until: 12 },
    { text: 'napoleon-priority', seconds: 16, step: 12, until: 13 },
    { text: 'napoleon-rest', seconds: 76, step: 13, until: 61 },
    { text: 'napoleon-late', seconds: 18, step: 61 },
    { text: 'napoleon-options', seconds: 20, step: 61 },
    { text: 'napoleon-end', seconds: 18, step: 61 },
  ],
  chinesepoker: [
    { text: 'start', seconds: 14, step: 0 },
    { text: 'cp-goal', seconds: 18, step: 0 },
    { text: 'cp-front', seconds: 18, step: 0, interaction: 'front' },
    { text: 'cp-middle', seconds: 20, step: 0, interaction: 'middle' },
    { text: 'cp-back', seconds: 18, step: 0, interaction: 'back' },
    { text: 'cp-edit', seconds: 20, step: 0, interaction: 'edit' },
    { text: 'cp-foul', seconds: 18, step: 0 },
    { text: 'cp-submit', seconds: 16, step: 0, until: 3 },
    { text: 'cp-reveal', seconds: 14, step: 3, until: 4 },
    { text: 'cp-bonus', seconds: 24, step: 4 },
    { text: 'cp-end', seconds: 18, step: 4 },
  ],
  liarsdice: [
    { text: 'start', seconds: 14, step: 0 },
    { text: 'dice-goal', seconds: 16, step: 0 },
    { text: 'dice-bid', seconds: 16, step: 0, until: 1 },
    { text: 'dice-open', seconds: 20, step: 1, until: 2 },
    { text: 'dice-ones', seconds: 30, step: 2, until: 4 },
    { text: 'dice-reset', seconds: 18, step: 4, until: 6 },
    { text: 'dice-raise', seconds: 20, step: 6, until: 9 },
    { text: 'dice-rest', seconds: 36, step: 9, until: 18 },
    { text: 'dice-end', seconds: 18, step: 18 },
  ],
};

export function isDemoGameType(game: GameType): game is DemoGameType {
  return DEMO_GAME_TYPES.some((candidate) => candidate === game);
}

/** The recording opens on its first scene before playback starts. */
export function demoChapters(game: DemoGameType): readonly { text: DemoTextKey; start: number }[] {
  let start = DEMO_RECORDINGS[game].leadIn;
  return DEMO_SCENES[game].map((scene, index) => {
    const chapter = { text: scene.text, start: index === 0 ? 0 : DEMO_RECORDINGS[game].chapters?.[index] ?? start };
    start += scene.seconds;
    return chapter;
  });
}
