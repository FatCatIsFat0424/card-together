import { DEMO_GAME_TYPES } from './game-demos';
import type { DemoGameType } from './game-demos';
import { parseDemoVideoCatalog } from './game-demo-videos';

/** An absent generated file means a checkout without the owner's videos in `local-demos/`. */
const generated = import.meta.glob<unknown>('./game-demo-videos.generated.json', { eager: true, import: 'default' });
const videos: ReadonlyMap<string, string> = new Map(
  parseDemoVideoCatalog(Object.values(generated)[0] ?? [], DEMO_GAME_TYPES).map((video) => [video.game, video.file]),
);

/** Imported video file name, or null when this build has no video for the lesson. */
export function demoVideoFile(game: DemoGameType): string | null {
  return videos.get(game) ?? null;
}
