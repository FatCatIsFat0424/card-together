import type { MatchStanding } from '../rules/match-standing';
import type { AccountStats, GameStats, GameType, StatsMark, StatsOutcome, StatsRecentResult } from '../types';
import { STATS_RECORDS, STATS_VERSION } from './definitions';
import type { SeatFacts } from './facts';

export const RECENT_RESULTS = 10;

/** One counted match of one seat. */
export interface CountedMatch {
  readonly gameType: GameType;
  readonly matchId: string;
  readonly at: number;
  readonly standing: MatchStanding;
  readonly facts: SeatFacts;
  /** The match's replay log was read, so log records include it */
  readonly logged: boolean;
  /** Where counting starts for an account whose older results were pruned; used only by new records */
  readonly since: number | null;
}

export function standingOutcome(standing: MatchStanding): StatsOutcome {
  if (!standing.won) return 'loss';
  return standing.rank !== null && standing.tied ? 'tie' : 'win';
}

function add(values: Readonly<Record<string, number>>, additions: Readonly<Record<string, number>>): Record<string, number> {
  const next = { ...values };
  for (const [key, amount] of Object.entries(additions)) {
    if (amount !== 0) next[key] = (next[key] ?? 0) + amount;
  }
  return next;
}

function emptyGameStats(gameType: GameType, since: number | null): GameStats {
  return { gameType, version: STATS_VERSION, since, versionSince: {}, matches: 0, wins: 0, ties: 0, ranks: [], tables: {},
    counts: {}, sums: {}, best: {}, latest: {}, streak: { current: 0, best: 0 }, logged: 0, logSince: null, lastAt: 0 };
}

/** Later definitions versions start counting with this match; their records were zero before it. */
function upgraded(stats: GameStats, at: number): Pick<GameStats, 'version' | 'versionSince'> {
  if (stats.version >= STATS_VERSION) return stats;
  const versionSince = { ...stats.versionSince };
  for (let version = stats.version + 1; version <= STATS_VERSION; version++) versionSince[String(version)] = at;
  return { version: STATS_VERSION, versionSince };
}

/** Adds one match to an account's counters for its game; pure, so live updates and the backfill share it. */
export function countGameMatch(previous: GameStats | null, match: CountedMatch): GameStats {
  const stats = previous ?? emptyGameStats(match.gameType, match.since);
  const { standing, facts, at, matchId } = match;
  const ranks = [...stats.ranks];
  const counts: Record<string, number> = {};
  const sums: Record<string, number> = { ...facts.sums };
  if (standing.rank !== null) {
    while (ranks.length < standing.players) ranks.push(0);
    ranks[standing.rank - 1] += 1;
    sums.rank = (sums.rank ?? 0) + standing.rank;
    if (standing.players > 2 && standing.rank <= 2) counts.topTwo = 1;
  }
  if (standing.role) {
    counts[`role.${standing.role}`] = 1;
    if (standing.won) counts[`won.${standing.role}`] = 1;
  }
  if (standing.score !== null) {
    sums.score = (sums.score ?? 0) + standing.score;
    if (!standing.won) sums.lossScore = (sums.lossScore ?? 0) + standing.score;
  }
  const best: Record<string, StatsMark> = { ...stats.best };
  const latest: Record<string, StatsMark> = { ...stats.latest };
  for (const definition of STATS_RECORDS[match.gameType]) {
    const value = facts.values[definition.id];
    if ((definition.kind === 'max' || definition.kind === 'min') && value !== undefined) {
      const current = best[definition.id];
      // The earlier match keeps a tied record.
      if (!current || (definition.kind === 'max' ? value > current.value : value < current.value)) {
        best[definition.id] = { value, matchId, at };
      }
    }
    const added = facts.counts[definition.id] ?? 0;
    if (definition.remember && added > 0) latest[definition.id] = { value: added, matchId, at };
  }
  const tables = { ...stats.tables, [String(standing.players)]: (stats.tables[String(standing.players)] ?? 0) + 1 };
  const current = standing.won ? stats.streak.current + 1 : 0;
  return {
    ...stats, ...upgraded(stats, at),
    matches: stats.matches + 1,
    wins: stats.wins + (standing.won ? 1 : 0),
    ties: stats.ties + (standing.won && standing.rank !== null && standing.tied ? 1 : 0),
    ranks, tables,
    counts: add(add(stats.counts, counts), facts.counts),
    sums: add(stats.sums, sums),
    best, latest,
    streak: { current, best: Math.max(stats.streak.best, current) },
    logged: stats.logged + (match.logged ? 1 : 0),
    logSince: match.logged && stats.logged === 0 && stats.matches > 0 ? at : stats.logSince,
    lastAt: Math.max(stats.lastAt, at),
  };
}

/** Adds one match to an account's cross-game streak and recent results. */
export function countAccountMatch(previous: AccountStats | null, match: CountedMatch): AccountStats {
  const stats = previous ?? { since: match.since, streak: { current: 0, best: 0 }, recent: [], lastAt: 0 };
  const current = match.standing.won ? stats.streak.current + 1 : 0;
  const result: StatsRecentResult = { gameType: match.gameType, matchId: match.matchId, at: match.at,
    outcome: standingOutcome(match.standing) };
  return {
    since: stats.since,
    streak: { current, best: Math.max(stats.streak.best, current) },
    recent: [...stats.recent, result].slice(-RECENT_RESULTS),
    lastAt: Math.max(stats.lastAt, match.at),
  };
}
