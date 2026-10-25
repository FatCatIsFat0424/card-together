import { getPresentationFrames } from '@shared/game-presentation';
import type { ReplaySnapshot } from '@shared/types';

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = typeof REPLAY_SPEEDS[number];

/** Shortest time a step stays on screen at 1x, so steps without animation stay readable. */
export const MIN_REPLAY_STEP_MS = 900;

/** Step 0 is the initial snapshot; step `n` follows the recording's n-th patch. */
export interface ReplayPlayback {
  readonly step: number;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
}

/**
 * Transport commands. `advance` is the auto-play tick sent when the current step's hold time
 * has elapsed; it is a timing signal rather than a user action.
 */
export type ReplayControl =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'previous' }
  | { readonly type: 'next' }
  | { readonly type: 'start' }
  | { readonly type: 'end' }
  | { readonly type: 'seek'; readonly step: number }
  | { readonly type: 'speed'; readonly speed: ReplaySpeed }
  | { readonly type: 'advance' };

export function isReplaySpeed(value: unknown): value is ReplaySpeed {
  return REPLAY_SPEEDS.some((speed) => speed === value);
}

export function clampReplayStep(step: number, total: number): number {
  return Number.isFinite(step) ? Math.max(0, Math.min(total, Math.trunc(step))) : 0;
}

/** Playback opens at the start and plays unless there is nothing to play. */
export function initialReplayPlayback(total: number): ReplayPlayback {
  return { step: 0, playing: total > 0, speed: 1 };
}

/** Seeking keeps the play state; reaching the last step pauses there. */
export function replayPlaybackReducer(state: ReplayPlayback, control: ReplayControl, total: number): ReplayPlayback {
  const at = (step: number, playing = state.playing): ReplayPlayback => {
    const next = clampReplayStep(step, total);
    return { ...state, step: next, playing: playing && next < total };
  };
  switch (control.type) {
    case 'play': return state.step >= total ? at(0, total > 0) : at(state.step, true);
    case 'pause': return state.playing ? { ...state, playing: false } : state;
    case 'previous': return at(state.step - 1);
    case 'next': return at(state.step + 1);
    case 'start': return at(0);
    case 'end': return at(total, false);
    case 'seek': return at(control.step);
    case 'speed': return isReplaySpeed(control.speed) ? { ...state, speed: control.speed } : state;
    case 'advance': return state.playing ? at(state.step + 1) : state;
  }
}

export interface ReplayFreshFrames {
  /** Presentation time already shown by the previous step. */
  readonly offsetMs: number;
  /** Presentation time this step adds. */
  readonly durationMs: number;
}

/**
 * The part of a step's presentation the previous step had not already shown. A step can keep its
 * predecessor's presentation, extend it, or start a new one.
 */
export function replayFreshFrames(previous: ReplaySnapshot | null, current: ReplaySnapshot): ReplayFreshFrames {
  const seen = new Set(previous ? getPresentationFrames(previous).map((frame) => frame.key) : []);
  let offsetMs = 0;
  let durationMs = 0;
  let fresh = false;
  for (const frame of getPresentationFrames(current)) {
    fresh ||= !seen.has(frame.key);
    if (fresh) durationMs += frame.durationMs;
    else offsetMs += frame.durationMs;
  }
  return { offsetMs, durationMs };
}

/** How long a step stays on screen at 1x before auto-play advances: its new frames, at least the minimum. */
export function replayStepHoldMs(previous: ReplaySnapshot | null, current: ReplaySnapshot): number {
  return Math.max(MIN_REPLAY_STEP_MS, replayFreshFrames(previous, current).durationMs);
}

export interface ReplayStepTime {
  readonly step: number;
  /** Time until the next step at this speed; `Infinity` on the last step. */
  readonly untilNextMs: number;
}

/**
 * The step auto-play reaches `elapsedMs` after leaving `anchorStep`, for sessions that derive
 * playback from a shared anchor time instead of ticking locally.
 */
export function replayStepAt(
  holdMs: (step: number) => number, total: number, anchorStep: number, elapsedMs: number, speed: ReplaySpeed,
): ReplayStepTime {
  let step = clampReplayStep(anchorStep, total);
  let remaining = Math.max(0, elapsedMs);
  while (step < total) {
    const hold = holdMs(step) / speed;
    if (remaining < hold) return { step, untilNextMs: hold - remaining };
    remaining -= hold;
    step++;
  }
  return { step, untilNextMs: Infinity };
}
