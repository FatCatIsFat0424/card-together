import { GAME_TYPES } from './constants/game-rules';
import type { RoomReplaySession } from './types/room';
import type { RoomReplayPlayback } from './types/socket-events';

export const REPLAY_SPEED_MIN = 0.5;
export const REPLAY_SPEED_MAX = 4;

/** Account and match identifiers accepted in replay requests and stored sessions. */
export function isReplayRecordId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

export function isReplaySpeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= REPLAY_SPEED_MIN && value <= REPLAY_SPEED_MAX;
}

function isStep(value: unknown, lastStep: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= lastStep;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRoomReplayPlayback(value: unknown, lastStep: number): value is RoomReplayPlayback {
  return isPlainObject(value) && Object.keys(value).length === 3 && isStep(value.step, lastStep)
    && typeof value.playing === 'boolean' && isReplaySpeed(value.speed);
}

const SESSION_KEYS = ['matchId', 'subjectId', 'gameType', 'startedBy', 'lastStep', 'anchorStep', 'anchorAt',
  'playing', 'speed'] as const;

/** Structural check for persisted sessions; membership rules are checked by the caller. */
export function isRoomReplaySession(value: unknown): value is RoomReplaySession {
  if (!isPlainObject(value) || Object.keys(value).length !== SESSION_KEYS.length
    || !SESSION_KEYS.every((key) => Object.hasOwn(value, key))) return false;
  const { lastStep } = value;
  return isReplayRecordId(value.matchId) && isReplayRecordId(value.subjectId) && typeof value.startedBy === 'string'
    && (GAME_TYPES as readonly unknown[]).includes(value.gameType)
    && typeof lastStep === 'number' && Number.isInteger(lastStep) && lastStep >= 0
    && isStep(value.anchorStep, lastStep) && typeof value.anchorAt === 'number' && Number.isFinite(value.anchorAt)
    && typeof value.playing === 'boolean' && isReplaySpeed(value.speed);
}

/**
 * Milliseconds a step stays on screen during 1x auto-play before the next one; the viewer
 * supplies it from the step's presentation. Non-finite or negative values count as zero.
 */
export type ReplayStepDuration = (step: number) => number;

export interface ReplaySessionPosition {
  readonly step: number;
  /** The last step is showing; playback stays there until the host seeks. */
  readonly finished: boolean;
  /** Server time of the next automatic advance; null while paused or finished. */
  readonly nextStepAt: number | null;
}

export type ReplayAnchor = Pick<RoomReplaySession, 'lastStep' | 'anchorStep' | 'anchorAt' | 'playing' | 'speed'>;

/** Derives the shared step from the anchor and server time, so playback needs no server timer. */
export function replaySessionPosition(
  session: ReplayAnchor, serverNow: number, stepDuration: ReplayStepDuration,
): ReplaySessionPosition {
  const lastStep = Math.max(0, Math.floor(session.lastStep));
  let step = Math.min(Math.max(0, Math.floor(session.anchorStep)), lastStep);
  if (!session.playing || step >= lastStep) return { step, finished: step >= lastStep, nextStepAt: null };
  const speed = isReplaySpeed(session.speed) ? session.speed : 1;
  const elapsed = Math.max(0, serverNow - session.anchorAt) * speed;
  let boundary = 0;
  while (step < lastStep) {
    const raw = stepDuration(step);
    const duration = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (boundary + duration > elapsed) {
      return { step, finished: false, nextStepAt: session.anchorAt + (boundary + duration) / speed };
    }
    boundary += duration;
    step += 1;
  }
  return { step: lastStep, finished: true, nextStepAt: null };
}
