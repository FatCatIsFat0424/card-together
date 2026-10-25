import type { PlayerVisibleGameState } from './game';
import type { GameType } from './room';

/** Object keys from the snapshot root; arrays are replaced or appended, never indexed. */
export type ReplayPath = readonly string[];

export type ReplayPatchOp =
  | { readonly op: 'set'; readonly path: ReplayPath; readonly value: unknown }
  | { readonly op: 'append'; readonly path: ReplayPath; readonly values: readonly unknown[] }
  | { readonly op: 'delete'; readonly path: ReplayPath };

/**
 * What an unseated spectator receives, so every dealt hand is visible. It never includes the
 * clock, and its presentation omits `serverNow` so playback restarts the animation frames.
 */
export type ReplaySnapshot = PlayerVisibleGameState;

/** Runtime-only while the match runs; never part of a live snapshot. */
export interface ReplayRecording {
  readonly initial: ReplaySnapshot;
  /** Each step patches the snapshot produced by the previous step. */
  readonly steps: readonly (readonly ReplayPatchOp[])[];
}

/** A completed match, visible under the subject's history permission. */
export interface MatchReplay extends ReplayRecording {
  readonly version: 1;
  readonly gameType: GameType;
  readonly startedAt: number;
}
