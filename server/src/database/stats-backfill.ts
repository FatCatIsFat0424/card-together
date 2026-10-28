import type { MatchReplay, ReplaySnapshot } from '@shared/types';
import type { StatsBackfillState, StatsSource, StatsStage } from './game-stats';
import { createStatsStage, replayFrame } from './game-stats';
import type { MatchRecord } from './repository';
import { MAX_MATCHES_PER_ACCOUNT } from './repository';

/** Matches counted per commit; replays are read one at a time, so memory stays bounded by one batch. */
export const STATS_BACKFILL_BATCH = 250;

/** How much of an account's history is stored, to tell whether pruning removed older results. */
export interface AccountHistory {
  /** Stored matches the account took part in */
  readonly matches: number;
  readonly oldest: number;
  /** Completed games on its achievement counter, which counts games whose results were pruned */
  readonly completed: number;
}

export interface StatsBackfillStore extends StatsSource {
  /** The pending backfill, or null once it finished */
  state(): Promise<StatsBackfillState | null>;
  histories(): Promise<ReadonlyMap<string, AccountHistory>>;
  isAccount(accountId: string): boolean;
  /** Stored matches after `after` in completion order, then by ID */
  matches(after: StatsBackfillState['after'], limit: number): Promise<MatchRecord[]>;
  /** The validated archive of a flagged match; undefined when it is missing or unreadable */
  replay(match: MatchRecord): Promise<MatchReplay | undefined>;
  /** Atomically writes the staged counters with the next state; null marks the backfill finished. */
  commit(stage: StatsStage, next: StatsBackfillState | null): Promise<void>;
}

export interface StatsBackfillResult {
  readonly matches: number;
  readonly logged: number;
}

/**
 * Where counting starts for an account whose older results were pruned: its oldest stored match.
 * Pruning keeps an account's latest `MAX_MATCHES_PER_ACCOUNT`; an achievement count above the stored
 * matches also shows that results are missing.
 */
export function prunedSince(history: AccountHistory | undefined): number | null {
  if (!history) return null;
  return history.matches >= MAX_MATCHES_PER_ACCOUNT || history.completed > history.matches ? history.oldest : null;
}

/**
 * Counts every stored match once, oldest first, before games open. Each batch commits its counters
 * together with the position reached, so an interrupted run resumes after the last committed batch
 * and nothing is counted twice. Matches completed later count live in the commit that stores them.
 */
export async function backfillGameStats(store: StatsBackfillStore): Promise<StatsBackfillResult | null> {
  let state = await store.state();
  if (!state) return null;
  const histories = await store.histories();
  const since = (accountId: string): number | null => prunedSince(histories.get(accountId));
  let matches = 0;
  let logged = 0;
  let unreadable = 0;
  while (state) {
    const batch = await store.matches(state.after, STATS_BACKFILL_BATCH);
    const stage = createStatsStage(store, (accountId) => store.isAccount(accountId));
    for (const match of batch) {
      let frame: ReplaySnapshot | null = null;
      try {
        frame = match.hasReplay ? replayFrame(await store.replay(match)) : null;
      } catch {
        unreadable++;
      }
      stage.count(match, frame, since);
      matches++;
      if (frame) logged++;
    }
    const last = batch.at(-1);
    state = last && batch.length === STATS_BACKFILL_BATCH ? { after: { at: last.finishedAt, matchId: last.id } } : null;
    await store.commit(stage, state);
  }
  if (unreadable > 0) console.warn(`[stats] ${unreadable} replay archives could not be read; their matches count without log records.`);
  return { matches, logged };
}
