import { describe, expect, it } from 'vitest';
import {
  isReplaySpeed, isRoomReplayPlayback, replaySessionPosition, REPLAY_SPEED_MAX, REPLAY_SPEED_MIN,
} from '@shared/replay-session';
import type { ReplayAnchor } from '@shared/replay-session';

const T0 = 50_000;
const anchor = (patch: Partial<ReplayAnchor> = {}): ReplayAnchor => ({
  lastStep: 4, anchorStep: 0, anchorAt: T0, playing: true, speed: 1, ...patch,
});
/** Steps 0..3 last 1000, 2000, 500, and 1500 ms at 1x. */
const durations = [1000, 2000, 500, 1500];
const duration = (step: number): number => durations[step];

describe('shared replay step timing', () => {
  it('stays on the anchor step while paused and reports the end', () => {
    expect(replaySessionPosition(anchor({ playing: false, anchorStep: 2 }), T0 + 60_000, duration))
      .toEqual({ step: 2, finished: false, nextStepAt: null });
    expect(replaySessionPosition(anchor({ playing: false, anchorStep: 4 }), T0, duration))
      .toEqual({ step: 4, finished: true, nextStepAt: null });
  });

  it('advances through each step duration from the anchor and schedules the next step', () => {
    expect(replaySessionPosition(anchor(), T0, duration)).toEqual({ step: 0, finished: false, nextStepAt: T0 + 1000 });
    expect(replaySessionPosition(anchor(), T0 + 999, duration).step).toBe(0);
    expect(replaySessionPosition(anchor(), T0 + 1000, duration)).toEqual({ step: 1, finished: false, nextStepAt: T0 + 3000 });
    expect(replaySessionPosition(anchor(), T0 + 3200, duration)).toEqual({ step: 2, finished: false, nextStepAt: T0 + 3500 });
    expect(replaySessionPosition(anchor({ anchorStep: 2, anchorAt: T0 + 10 }), T0 + 510, duration))
      .toEqual({ step: 3, finished: false, nextStepAt: T0 + 2010 });
  });

  it('scales by speed and treats clock skew before the anchor as the anchor itself', () => {
    expect(replaySessionPosition(anchor({ speed: 2 }), T0 + 500, duration))
      .toEqual({ step: 1, finished: false, nextStepAt: T0 + 1500 });
    expect(replaySessionPosition(anchor({ speed: 0.5 }), T0 + 1999, duration).step).toBe(0);
    expect(replaySessionPosition(anchor(), T0 - 5000, duration).step).toBe(0);
  });

  it('clamps to the last step and reports finished', () => {
    expect(replaySessionPosition(anchor(), T0 + 5000, duration)).toEqual({ step: 4, finished: true, nextStepAt: null });
    expect(replaySessionPosition(anchor(), T0 + 3_600_000, duration)).toEqual({ step: 4, finished: true, nextStepAt: null });
    expect(replaySessionPosition(anchor({ anchorStep: 9 }), T0, duration)).toEqual({ step: 4, finished: true, nextStepAt: null });
  });

  it('skips steps with zero, negative, or invalid durations instead of stalling', () => {
    const odd = [0, -5, Number.NaN, 300];
    expect(replaySessionPosition(anchor(), T0, (step) => odd[step]))
      .toEqual({ step: 3, finished: false, nextStepAt: T0 + 300 });
  });

  it('validates host playback requests against the session length and speed range', () => {
    expect(isReplaySpeed(REPLAY_SPEED_MIN) && isReplaySpeed(REPLAY_SPEED_MAX) && isReplaySpeed(1.5)).toBe(true);
    for (const speed of [0, 0.25, 4.5, Number.POSITIVE_INFINITY, '1']) expect(isReplaySpeed(speed)).toBe(false);
    expect(isRoomReplayPlayback({ step: 4, playing: true, speed: 1 }, 4)).toBe(true);
    for (const value of [
      { step: 5, playing: true, speed: 1 }, { step: -1, playing: true, speed: 1 }, { step: 1.5, playing: true, speed: 1 },
      { step: 1, playing: 'yes', speed: 1 }, { step: 1, playing: true, speed: 5 },
      { step: 1, playing: true, speed: 1, anchorAt: 0 }, null, [1, true, 1],
    ]) expect(isRoomReplayPlayback(value, 4)).toBe(false);
  });
});
