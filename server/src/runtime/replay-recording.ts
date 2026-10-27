import { applyReplayPatch, diffReplaySnapshot } from '@shared/replay-patch';
import type { AnyGameState, ReplayRecording, ReplaySnapshot } from '@shared/types';
import * as gameManager from '../managers/game-manager';

/**
 * Snapshot each recording ends with. Keyed by the recording object, which is replaced rather
 * than mutated, so a rolled-back or restored recording can never match a newer snapshot.
 */
const latestSnapshots = new WeakMap<ReplayRecording, ReplaySnapshot>();

/**
 * What an unseated spectator sees, as plain JSON detached from live state. The clock and the
 * presentation's server time are dropped so playback restarts each presentation afresh.
 */
export function captureReplaySnapshot(game: AnyGameState): ReplaySnapshot | null {
  const visible = gameManager.getRecipientVisibleState(game.roomCode, null);
  if (!visible || visible.gameType !== game.gameType) return null;
  const { clock: _clock, presentation, ...rest } = visible;
  const snapshot = presentation ? { ...rest, presentation: { ...presentation, serverNow: undefined } } : rest;
  return JSON.parse(JSON.stringify(snapshot)) as ReplaySnapshot;
}

function latestSnapshot(recording: ReplayRecording): ReplaySnapshot {
  let snapshot = latestSnapshots.get(recording);
  if (!snapshot) {
    snapshot = recording.steps.reduce<ReplaySnapshot>((current, step) => applyReplayPatch(current, step), recording.initial);
    latestSnapshots.set(recording, snapshot);
  }
  return snapshot;
}

/**
 * Records the game's spectator view after a mutation, inside the caller's rollback boundary.
 * `previous` is the game as committed before the mutation, absent for a newly started game.
 */
export function recordReplayStep(game: AnyGameState, previous: AnyGameState | undefined): void {
  // Old in-progress games cannot recover their initial deal, and finished ones are archived.
  if (previous && (!game.replayRecording || previous.result)) return;
  const snapshot = captureReplaySnapshot(game);
  if (!snapshot) return;
  if (!game.replayRecording) {
    const recording: ReplayRecording = { initial: snapshot, steps: [] };
    latestSnapshots.set(recording, snapshot);
    game.replayRecording = recording;
    return;
  }
  const recording = game.replayRecording;
  const step = diffReplaySnapshot(latestSnapshot(recording), snapshot);
  if (step.length === 0) return;
  const next: ReplayRecording = { initial: recording.initial, steps: [...recording.steps, step] };
  latestSnapshots.set(next, snapshot);
  game.replayRecording = next;
}
