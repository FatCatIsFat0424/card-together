import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { DEMO_GAME_TYPES, DEMO_SCENES, isDemoGameType } from '../../client/src/game-demos';
import type { DemoGameType } from '../../client/src/game-demos';
import type { GameType } from '@shared/types';

/**
 * Records walkthrough videos from the development recording page with headless Chromium: CDP screencast frames
 * carry wall-clock timestamps from the page's clock, so scene starts need no manual calibration. After every take
 * has finished it writes the MP4s to `local-demos/`, the measured starts to `game-demo-recordings.json`, and the
 * subtitles, because writing under `client/` while a take runs would reload the stage.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RECORDINGS_FILE = join(ROOT, 'client/src/game-demo-recordings.json');
const VIEWPORT = { width: 1280, height: 960 } as const;
const FPS = 30;
/** Reading time kept after the last scene. */
const TAIL_SECONDS = 1;
/** A scene may run this much longer or shorter than planned before the take is rejected. */
const SCENE_TOLERANCE_SECONDS = 0.15;

export interface RecordOptions {
  readonly url: string;
  readonly games: readonly DemoGameType[];
  readonly quick: boolean;
  readonly parallel: number;
  readonly work: string;
}

export interface TakeFrame {
  readonly file: string;
  /** Seconds since the epoch, from the screencast metadata. */
  readonly timestamp: number;
}

export interface Take {
  readonly done: boolean;
  readonly error: string | null;
  /** Epoch milliseconds at which each scene started. */
  readonly timeline: readonly number[];
  readonly finishedAt: number | null;
  readonly frames: readonly TakeFrame[];
}

export interface Calibration {
  readonly duration: number;
  readonly starts: readonly number[];
  readonly ffconcat: string;
}

/** The recording stage's driver as seen from Playwright callbacks, which run in the page. */
interface StageWindow {
  readonly demoRecording?: {
    readonly ready: boolean;
    readonly done: boolean;
    readonly error: string | null;
    readonly timeline: readonly number[];
    readonly finishedAt: number | null;
    run: (rate?: number) => void;
  };
}

const USAGE = 'Usage: npm run demos:record -- --url <recording page origin> [--games all|g1,g2] [--quick] [--parallel 1-6] [--work <dir>]';

export function parseRecordArgs(args: readonly string[], work = join(tmpdir(), 'card-together-demos')): RecordOptions {
  let url: string | null = null;
  let games: readonly DemoGameType[] = DEMO_GAME_TYPES;
  let quick = false;
  let parallel = 3;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--quick') { quick = true; continue; }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(USAGE);
    index += 1;
    if (flag === '--url') {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Unsupported URL: ${value}`);
      url = parsed.origin;
    } else if (flag === '--games') {
      if (value !== 'all') {
        const names = value.split(',');
        const unknown = names.filter((name) => !isDemoGameType(name as GameType));
        if (unknown.length > 0) throw new Error(`Not in DEMO_GAME_TYPES: ${unknown.join(', ')}`);
        games = [...new Set(names)] as DemoGameType[];
      }
    } else if (flag === '--parallel') {
      parallel = Number(value);
      if (!Number.isInteger(parallel) || parallel < 1 || parallel > 6) throw new Error(USAGE);
    } else if (flag === '--work') {
      work = resolve(value);
    } else {
      throw new Error(USAGE);
    }
  }
  if (!url) throw new Error(USAGE);
  return { url, games, quick, parallel, work };
}

export function courseSeconds(game: DemoGameType): number {
  return DEMO_SCENES[game].reduce((sum, scene) => sum + scene.seconds, 0);
}

/** Scenes whose measured length differs from the plan, e.g. because restoring many steps overran a fast-forward. */
export function sceneTimingErrors(game: DemoGameType, take: Pick<Take, 'timeline' | 'finishedAt'>): readonly string[] {
  const scenes = DEMO_SCENES[game];
  if (take.timeline.length !== scenes.length || take.finishedAt === null) {
    return [`expected ${scenes.length} scenes, measured ${take.timeline.length}`];
  }
  const ends = [...take.timeline.slice(1), take.finishedAt];
  return scenes.flatMap((scene, index) => {
    const measured = (ends[index]! - take.timeline[index]!) / 1000;
    return Math.abs(measured - scene.seconds) > SCENE_TOLERANCE_SECONDS
      ? [`${scene.text}: ${measured.toFixed(2)} s instead of ${scene.seconds} s`] : [];
  });
}

/**
 * Video time 0 is the first scene start, when the stage lifts its black curtain; earlier frames are dropped. Each
 * frame lasts until the next one (the screencast only sends changed frames), and the last one until the tail ends.
 */
export function calibrateTake(take: Take, frameDir: string): Calibration {
  const zero = take.timeline[0]! / 1000;
  const end = take.finishedAt! / 1000 - zero + TAIL_SECONDS;
  const duration = Math.round(end * FPS) / FPS;
  const visible = take.frames.filter((frame) => frame.timestamp >= zero);
  if (visible.length === 0) throw new Error('The take has no frame after the curtain lifted.');
  const lines = ['ffconcat version 1.0'];
  visible.forEach((frame, index) => {
    const start = index === 0 ? 0 : frame.timestamp - zero;
    const next = visible[index + 1];
    const stop = next ? next.timestamp - zero : duration;
    lines.push(`file '${join(frameDir, frame.file)}'`, `duration ${Math.max(0.001, stop - start).toFixed(6)}`);
  });
  // The concat demuxer ignores the last entry's duration unless the file is repeated.
  lines.push(`file '${join(frameDir, visible.at(-1)!.file)}'`);
  const starts = take.timeline.map((time) => Math.round((time / 1000 - zero) * 1000) / 1000);
  return { duration, starts, ffconcat: `${lines.join('\n')}\n` };
}

/** Parses ffmpeg's `Duration: HH:MM:SS.cc` banner line. */
export function parseFfmpegDuration(output: string): number | null {
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(output);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

async function recordTake(browser: Browser, url: string, game: DemoGameType, dir: string, quick: boolean): Promise<Take> {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'zh-TW' });
  try {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${url}/demo-recording.html?game=${game}`);
    await page.waitForFunction(() => (window as unknown as StageWindow).demoRecording?.ready === true, null, { timeout: 60_000 });
    // Let fonts and lazy table assets settle before the first frame.
    await page.waitForTimeout(3000);
    const frames: TakeFrame[] = [];
    const session = await page.context().newCDPSession(page);
    if (!quick) {
      mkdirSync(join(dir, 'frames'), { recursive: true });
      session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const file = `frames/${String(frames.length).padStart(6, '0')}.jpg`;
        writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
        frames.push({ file, timestamp: metadata.timestamp ?? Date.now() / 1000 });
        void session.send('Page.screencastFrameAck', { sessionId });
      });
      await session.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height, everyNthFrame: 1 });
      // The curtain frames before `run()` let calibration find the first scene frame.
      await page.waitForTimeout(1500);
    }
    await page.evaluate((rate) => (window as unknown as StageWindow).demoRecording!.run(rate), quick ? 20 : 1);
    await page.waitForFunction(() => {
      const driver = (window as unknown as StageWindow).demoRecording!;
      return driver.done || driver.error !== null;
    }, null,
      { timeout: 600_000, polling: 200 });
    const state = await page.evaluate(() => {
      const driver = (window as unknown as StageWindow).demoRecording!;
      return { done: driver.done, error: driver.error, timeline: [...driver.timeline], finishedAt: driver.finishedAt };
    });
    if (!quick) {
      await page.waitForTimeout((TAIL_SECONDS + 0.5) * 1000);
      await session.send('Page.stopScreencast');
    }
    return { ...state, error: state.error ?? errors[0] ?? null, frames };
  } finally {
    await page.close();
  }
}

function ffmpeg(binary: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let output = '';
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolvePromise(output) : reject(new Error(`ffmpeg exited ${code}: ${output.slice(-400)}`)));
  });
}

interface Recorded {
  readonly game: DemoGameType;
  readonly video: string;
  readonly duration: number;
  readonly starts: readonly number[];
}

async function recordGame(browser: Browser, options: RecordOptions, game: DemoGameType, ffmpegPath: string | null): Promise<Recorded | null> {
  const dir = join(options.work, game);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const take = await recordTake(browser, options.url, game, dir, options.quick);
  if (!take.done || take.error) throw new Error(take.error ?? 'the course did not finish');
  if (options.quick) return null;
  const timing = sceneTimingErrors(game, take);
  if (timing.length > 0) throw new Error(`scene timing off: ${timing.join('; ')}`);
  const calibration = calibrateTake(take, dir);
  writeFileSync(join(dir, 'frames.ffconcat'), calibration.ffconcat);
  const video = join(options.work, `${game}.mp4`);
  await ffmpeg(ffmpegPath!, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'),
    '-vf', `fps=${FPS},tpad=stop_mode=clone:stop_duration=2,format=yuv420p`, '-t', calibration.duration.toFixed(3),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', '-an', video]);
  // Contact sheet for a quick visual review: no burned-in text, nothing hidden revealed early.
  await ffmpeg(ffmpegPath!, ['-hide_banner', '-y', '-i', video, '-vf', 'fps=1/10,scale=320:-1,tile=5x2', '-frames:v', '1',
    join(options.work, `${game}-sheet.png`)]);
  const probed = parseFfmpegDuration(await ffmpeg(ffmpegPath!, ['-hide_banner', '-i', video, '-f', 'null', '-']));
  if (probed === null) throw new Error('ffmpeg did not report the video duration');
  rmSync(join(dir, 'frames'), { recursive: true, force: true });
  return { game, video, duration: probed, starts: calibration.starts };
}

async function pool<T>(items: readonly T[], size: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await task(item);
  }));
}

function apply(recorded: readonly Recorded[]): void {
  const recordings = JSON.parse(readFileSync(RECORDINGS_FILE, 'utf8')) as Record<string, unknown>;
  mkdirSync(join(ROOT, 'local-demos'), { recursive: true });
  for (const { game, video, duration, starts } of recorded) {
    copyFileSync(video, join(ROOT, 'local-demos', `${game}.mp4`));
    recordings[game] = { leadIn: 0, duration, starts };
  }
  const lines = Object.entries(recordings).map(([game, value]) =>
    `  "${game}": ${JSON.stringify(value).replaceAll(',', ', ').replaceAll(':', ': ').replace(/^\{/, '{ ').replace(/\}$/, ' }')}`);
  writeFileSync(RECORDINGS_FILE, `{\n${lines.join(',\n')}\n}\n`);
  const tsx = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
  for (const command of [[tsx, '--tsconfig', 'server/tsconfig.json', 'scripts/game-demos/write-subtitles.ts'],
    ['scripts/demos/import-demo-videos.mjs']]) {
    const result = spawnSync(process.execPath, command, { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`${command.at(-1)} failed`);
  }
}

async function main(): Promise<void> {
  const options = parseRecordArgs(process.argv.slice(2));
  const ffmpegPath = options.quick ? null : process.env.FFMPEG ?? null;
  if (!options.quick && !ffmpegPath) throw new Error('Set FFMPEG to an ffmpeg binary with libx264 (see docs/game-demos.md).');
  mkdirSync(options.work, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  const recorded: Recorded[] = [];
  const failed: string[] = [];
  try {
    await pool(options.games, options.parallel, async (game) => {
      try {
        const result = await recordGame(browser, options, game, ffmpegPath);
        if (result) recorded.push(result);
        console.log(`${game}: ${result ? `${result.duration.toFixed(2)} s, ${result.video}` : 'quick run passed'}`);
      } catch (error) {
        failed.push(game);
        console.error(`${game}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  } finally {
    await browser.close();
  }
  if (recorded.length > 0) {
    recorded.sort((a, b) => DEMO_GAME_TYPES.indexOf(a.game) - DEMO_GAME_TYPES.indexOf(b.game));
    apply(recorded);
    console.log(`Applied ${recorded.length} recordings; review the contact sheets in ${options.work}.`);
  }
  if (failed.length > 0) throw new Error(`Failed: ${failed.join(', ')}. Retry them alone; parallel load can cause spurious failures.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
