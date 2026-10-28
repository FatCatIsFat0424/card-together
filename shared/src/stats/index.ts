import { applyReplayPatch } from '../replay-patch';
import type { GameSeat, MatchReplay, MatchResult, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { gameFacts } from './registry';

export type { SeatFacts } from './facts';

/**
 * The game's facts for one seat from its result and, when the match was recorded, the final
 * spectator frame of its replay. Live updates and the backfill both come through here, so stored
 * and recounted counters agree. Log facts are added only when `frame` is given.
 */
export function matchFacts(result: MatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  // Only the data: extractors return their builders.
  const { counts, sums, values } = gameFacts(result.gameType, result, seat, frame);
  return { counts, sums, values };
}

/** The last recorded spectator frame: every step applied to the initial snapshot. Throws on an invalid patch. */
export function finalReplayFrame(replay: Pick<MatchReplay, 'initial' | 'steps'>): ReplaySnapshot {
  let frame = replay.initial;
  for (const step of replay.steps) frame = applyReplayPatch(frame, step);
  return frame;
}
