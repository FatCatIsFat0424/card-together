import { afterEach, describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import type { ReplaySnapshot } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import {
  initialReplayPlayback, MIN_REPLAY_STEP_MS, replayFreshFrames, replayPlaybackReducer, replayStepAt, replayStepHoldMs,
} from '../../../client/src/replay-playback';
import type { ReplayControl, ReplayPlayback } from '../../../client/src/replay-playback';
import { godViewSource } from '../../../client/src/games/replay-mode';
import { recordMatch } from './replay-fixtures';

const run = (controls: readonly ReplayControl[], total = 5, state = initialReplayPlayback(total)): ReplayPlayback =>
  controls.reduce((current, control) => replayPlaybackReducer(current, control, total), state);

afterEach(() => { games.restoreGames([]); });

describe('replay playback state', () => {
  it('opens playing from the start unless the recording has no steps', () => {
    expect(initialReplayPlayback(5)).toEqual({ step: 0, playing: true, speed: 1 });
    expect(initialReplayPlayback(0)).toEqual({ step: 0, playing: false, speed: 1 });
  });

  it('advances only while playing and pauses on the last step', () => {
    expect(run([{ type: 'advance' }, { type: 'advance' }])).toEqual({ step: 2, playing: true, speed: 1 });
    expect(run([{ type: 'pause' }, { type: 'advance' }])).toMatchObject({ step: 0, playing: false });
    expect(run(Array.from({ length: 9 }, () => ({ type: 'advance' as const })))).toMatchObject({ step: 5, playing: false });
  });

  it('keeps the play state while seeking, stepping, and changing speed', () => {
    expect(run([{ type: 'seek', step: 3 }])).toMatchObject({ step: 3, playing: true });
    expect(run([{ type: 'pause' }, { type: 'next' }, { type: 'next' }, { type: 'previous' }]))
      .toMatchObject({ step: 1, playing: false });
    expect(run([{ type: 'seek', step: 4 }, { type: 'start' }])).toMatchObject({ step: 0, playing: true });
    expect(run([{ type: 'speed', speed: 4 }])).toMatchObject({ speed: 4, playing: true });
  });

  it('clamps seeks, ends paused, and restarts from the start when played at the end', () => {
    expect(run([{ type: 'seek', step: 99 }])).toMatchObject({ step: 5, playing: false });
    expect(run([{ type: 'seek', step: -3 }])).toMatchObject({ step: 0 });
    expect(run([{ type: 'seek', step: Number.NaN }])).toMatchObject({ step: 0 });
    const ended = run([{ type: 'end' }]);
    expect(ended).toMatchObject({ step: 5, playing: false });
    expect(run([{ type: 'play' }], 5, ended)).toMatchObject({ step: 0, playing: true });
    expect(run([{ type: 'next' }], 5, ended)).toEqual(ended);
  });

  it('ignores speeds outside the offered set', () => {
    const state = initialReplayPlayback(5);
    expect(replayPlaybackReducer(state, { type: 'speed', speed: 3 as never }, 5)).toBe(state);
  });
});

describe('replay step timing', () => {
  const { snapshots } = recordMatch('bigtwo', 'TIMING');
  const withFrames = snapshots.findIndex((snapshot, index) => index > 0 && getPresentationFrames(snapshot).length > 0);
  const framesMs = (snapshot: ReplaySnapshot): number =>
    getPresentationFrames(snapshot).reduce((total, frame) => total + frame.durationMs, 0);

  it('waits for the frames a step adds, never less than the readable minimum', () => {
    expect(withFrames).toBeGreaterThan(0);
    const current = snapshots[withFrames];
    expect(replayFreshFrames(snapshots[withFrames - 1], current)).toEqual({ offsetMs: 0, durationMs: framesMs(current) });
    expect(replayStepHoldMs(snapshots[withFrames - 1], current)).toBe(Math.max(MIN_REPLAY_STEP_MS, framesMs(current)));
  });

  it('does not replay frames the previous step already showed', () => {
    const current = snapshots[withFrames];
    expect(replayFreshFrames(current, current)).toEqual({ offsetMs: framesMs(current), durationMs: 0 });
    expect(replayStepHoldMs(current, current)).toBe(MIN_REPLAY_STEP_MS);
    const { presentation: _presentation, ...plain } = current;
    expect(replayFreshFrames(snapshots[withFrames - 1], plain as ReplaySnapshot)).toEqual({ offsetMs: 0, durationMs: 0 });
  });

  it('starts an extended presentation at its first new frame', () => {
    const current = snapshots.find((snapshot) => getPresentationFrames(snapshot).length >= 2);
    if (!current) throw new Error('Expected a multi-frame presentation.');
    const shorter = { ...current, log: current.log.slice(0, -1) } as ReplaySnapshot;
    const kept = framesMs(shorter);
    expect(kept).toBeGreaterThan(0);
    expect(replayFreshFrames(shorter, current)).toEqual({ offsetMs: kept, durationMs: framesMs(current) - kept });
  });

  it('derives the shared step from an anchor and elapsed time at any speed', () => {
    const holds = [1000, 2000, 900, 1500];
    const hold = (step: number): number => holds[step];
    expect(replayStepAt(hold, 4, 0, 0, 1)).toEqual({ step: 0, untilNextMs: 1000 });
    expect(replayStepAt(hold, 4, 0, 2500, 1)).toEqual({ step: 1, untilNextMs: 500 });
    expect(replayStepAt(hold, 4, 0, 2500, 2)).toEqual({ step: 3, untilNextMs: 200 });
    expect(replayStepAt(hold, 4, 1, 999, 0.5)).toEqual({ step: 1, untilNextMs: 3001 });
    expect(replayStepAt(hold, 4, 2, 60_000, 4)).toEqual({ step: 4, untilNextMs: Infinity });
    expect(replayStepAt(hold, 4, 9, 0, 1)).toEqual({ step: 4, untilNextMs: Infinity });
  });
});

describe('replay god view', () => {
  const before = { gameType: 'bridge', step: 'before' } as unknown as ReplaySnapshot;
  const after = { gameType: 'bridge', step: 'after' } as unknown as ReplaySnapshot;

  it('shows the hands from before a playing step, since continuous playback never unlocks', () => {
    expect(godViewSource(after, true, { chat: false, before })).toEqual({ visible: before, locked: false });
    expect(godViewSource(after, false, { chat: false, before })).toEqual({ visible: after, locked: false });
    expect(godViewSource(after, true, { chat: false, before: null })).toEqual({ visible: after, locked: false });
  });

  it('keeps holding the hands at a live table', () => {
    expect(godViewSource(after, true, null)).toEqual({ visible: after, locked: true });
  });
});
