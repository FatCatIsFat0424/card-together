import { DEMO_RECORDINGS, DEMO_SCENES } from '../../client/src/game-demos';
import type { DemoGameType } from '../../client/src/game-demos';
import { gameDemoTranslations } from '../../client/src/game-demo-i18n';
import type { Locale } from '../../client/src/i18n';

export interface DemoCue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Video seconds where each scene starts: measured for a recorded take, otherwise derived from the timeline. */
export function demoSceneStarts(game: DemoGameType): readonly number[] {
  const recording = DEMO_RECORDINGS[game];
  if (recording.starts) return recording.starts;
  let start = recording.leadIn;
  return DEMO_SCENES[game].map((scene) => {
    const current = start;
    start += scene.seconds;
    return current;
  });
}

/** Subtitle cues for one locale; the first cue covers the opening frame and the last one the closing hold. */
export function demoCues(game: DemoGameType, locale: Locale): readonly DemoCue[] {
  const scenes = DEMO_SCENES[game];
  const starts = demoSceneStarts(game);
  return scenes.flatMap((scene, index) => {
    const start = index === 0 ? 0 : starts[index];
    const end = starts[index + 1] ?? DEMO_RECORDINGS[game].duration;
    const text = gameDemoTranslations[locale][scene.text];
    if (typeof text === 'string') return [{ start, end, text }];
    const split = starts[index] + (scene.split ?? scene.seconds / 2);
    return [{ start, end: split, text: text[0] }, { start: split, end, text: text[1] }];
  });
}

function timestamp(seconds: number): string {
  const millis = Math.round(seconds * 1000);
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `${pad(Math.floor(millis / 3_600_000))}:${pad(Math.floor(millis / 60_000) % 60)}:${pad(Math.floor(millis / 1000) % 60)}.${pad(millis % 1000, 3)}`;
}

/** Cues sit at the top, over the title bar, so they never cover the player's own hand or controls. */
export function demoVtt(game: DemoGameType, locale: Locale): string {
  const cues = demoCues(game, locale).map((cue) => `${timestamp(cue.start)} --> ${timestamp(cue.end)} line:0\n${cue.text}`);
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
