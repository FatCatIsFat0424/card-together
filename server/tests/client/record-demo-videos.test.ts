import { describe, expect, it } from 'vitest';
import { DEMO_GAME_TYPES, DEMO_SCENES } from '../../../client/src/game-demos';
import {
  calibrateTake, courseSeconds, parseFfmpegDuration, parseRecordArgs, sceneTimingErrors,
} from '../../../scripts/game-demos/record-videos';

/** Scene start times (epoch ms) that follow the plan exactly, starting at `zero` seconds. */
function plannedTimeline(zero: number): { timeline: number[]; finishedAt: number } {
  const timeline: number[] = [];
  let at = zero * 1000;
  for (const scene of DEMO_SCENES.bridge) {
    timeline.push(at);
    at += scene.seconds * 1000;
  }
  return { timeline, finishedAt: at };
}

describe('walkthrough recorder', () => {
  it('parses options with defaults', () => {
    expect(parseRecordArgs(['--url', 'http://127.0.0.1:6205/demo-recording.html'], '/work')).toEqual({
      url: 'http://127.0.0.1:6205', games: DEMO_GAME_TYPES, quick: false, parallel: 3, work: '/work',
    });
    expect(parseRecordArgs(['--url', 'http://h:1', '--games', 'chess,go,chess', '--quick', '--parallel', '2'], '/w'))
      .toMatchObject({ games: ['chess', 'go'], quick: true, parallel: 2 });
  });

  it.each([[[]], [['--games', 'chess']], [['--url']], [['--url', 'ftp://h']], [['--url', 'http://h', '--games', 'poker']],
    [['--url', 'http://h', '--parallel', '9']], [['--url', 'http://h', '--wat', '1']]])('rejects %j', (args) => {
    expect(() => parseRecordArgs(args)).toThrow();
  });

  it('accepts a take on plan and names scenes that drift', () => {
    const take = plannedTimeline(1000);
    expect(sceneTimingErrors('bridge', take)).toEqual([]);
    const late = { ...take, timeline: take.timeline.map((time, index) => index === 2 ? time + 400 : time) };
    expect(sceneTimingErrors('bridge', late)).toHaveLength(2);
    expect(sceneTimingErrors('bridge', { ...take, timeline: take.timeline.slice(1) })[0]).toMatch(/expected/);
  });

  it('starts the video at the curtain lift and ends one second after the course', () => {
    const take = plannedTimeline(1000);
    const frames = [{ file: 'frames/0.jpg', timestamp: 999.5 }, { file: 'frames/1.jpg', timestamp: 1000.04 },
      { file: 'frames/2.jpg', timestamp: 1010 }];
    const calibration = calibrateTake({ done: true, error: null, ...take, frames }, '/take');
    expect(calibration.starts[0]).toBe(0);
    expect(calibration.starts.at(-1)).toBe(courseSeconds('bridge') - DEMO_SCENES.bridge.at(-1)!.seconds);
    expect(calibration.duration).toBeCloseTo(courseSeconds('bridge') + 1, 5);
    expect(calibration.ffconcat).not.toContain('0.jpg\'');
    expect(calibration.ffconcat.split('\n').filter((line) => line.startsWith('file'))).toEqual([
      'file \'/take/frames/1.jpg\'', 'file \'/take/frames/2.jpg\'', 'file \'/take/frames/2.jpg\'',
    ]);
  });

  it('reads the duration from the ffmpeg banner', () => {
    expect(parseFfmpegDuration('  Duration: 00:01:19.03, start: 0.000000')).toBeCloseTo(79.03, 5);
    expect(parseFfmpegDuration('no banner')).toBeNull();
  });
});
