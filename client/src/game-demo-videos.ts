/** One imported walkthrough video; `file` is a content-hashed name inside `game-demos/`, not a URL. */
export interface DemoVideo {
  readonly game: string;
  readonly file: string;
}

export const DEMO_VIDEO_FILE = /^([a-z]+)-[a-f0-9]{24}\.mp4$/;
/** Allowed gap between a video and its recorded length; container rounding stays far below it. */
export const DEMO_DURATION_TOLERANCE = 0.1;

/** Validates the catalog written by `npm run demos:import`; shared with that Node script. */
export function parseDemoVideoCatalog(value: unknown, games: readonly string[]): readonly DemoVideo[] {
  if (!Array.isArray(value)) throw new Error('Demo video catalog must be an array.');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Demo video entries must be objects.');
    const { game, file } = entry as Record<string, unknown>;
    if (typeof game !== 'string' || !games.includes(game) || seen.has(game)) {
      throw new Error(`Invalid or duplicate demo video game: ${String(game)}`);
    }
    if (typeof file !== 'string' || DEMO_VIDEO_FILE.exec(file)?.[1] !== game) {
      throw new Error(`Invalid demo video file for ${game}: ${String(file)}`);
    }
    seen.add(game);
    return { game, file };
  });
}
