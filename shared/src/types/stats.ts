import type { GameType } from './room';

/** `human` counts matches without a bot seat; `all` counts every match, so it includes `human`. */
export type StatsScope = 'human' | 'all';

export type StatsOutcome = 'win' | 'loss' | 'tie';

/** A record's value and the match that set it. */
export interface StatsMark {
  readonly value: number;
  readonly matchId: string;
  readonly at: number;
}

export interface StatsStreak {
  readonly current: number;
  readonly best: number;
}

/** One account's counters for one game in one scope; definitions: `shared/src/stats/definitions.ts`. */
export interface GameStats {
  readonly gameType: GameType;
  /** The definitions version these counters follow */
  readonly version: number;
  /** Counting started with this match because older results were pruned first; null when every result counts */
  readonly since: number | null;
  /** When each later definitions version started counting here, keyed by version */
  readonly versionSince: Readonly<Record<string, number>>;
  readonly matches: number;
  /** First place, ties included, or the winning side */
  readonly wins: number;
  /** Wins shared with another seat at first place */
  readonly ties: number;
  /** Finishes by rank, index 0 is first; empty for side games */
  readonly ranks: readonly number[];
  /** Matches by the number of seats that took part */
  readonly tables: Readonly<Record<string, number>>;
  readonly counts: Readonly<Record<string, number>>;
  readonly sums: Readonly<Record<string, number>>;
  /** Single-match extremes of `max` and `min` records */
  readonly best: Readonly<Record<string, StatsMark>>;
  /** The latest match of remembered counts; `value` is the count it added */
  readonly latest: Readonly<Record<string, StatsMark>>;
  readonly streak: StatsStreak;
  /** Matches whose replay log was read; log records cover only these */
  readonly logged: number;
  /** The first logged match when earlier counted matches had no log; null otherwise */
  readonly logSince: number | null;
  /** Completion time of the latest counted match */
  readonly lastAt: number;
}

export interface StatsRecentResult {
  readonly gameType: GameType;
  readonly matchId: string;
  readonly at: number;
  readonly outcome: StatsOutcome;
}

/** Cross-game counters of one account in one scope. */
export interface AccountStats {
  /** Counting started with this match because older results were pruned first; null when every result counts */
  readonly since: number | null;
  readonly streak: StatsStreak;
  /** Oldest first, at most ten */
  readonly recent: readonly StatsRecentResult[];
  readonly lastAt: number;
}

export interface RoleTally {
  readonly played: number;
  readonly won: number;
}

export interface ScopeStats {
  /** Null before the first counted match */
  readonly account: AccountStats | null;
  readonly games: readonly GameStats[];
}

/** `GET /api/players/:id/stats` */
export interface PlayerStats {
  /** The server's definitions version; records with an older `version` lack the newer records */
  readonly version: number;
  readonly scopes: Readonly<Record<StatsScope, ScopeStats>>;
  /** Napoleon results of every player by role, the baseline of the role-weighted expectation */
  readonly napoleonRoles: Readonly<Record<StatsScope, Readonly<Partial<Record<'napoleon' | 'secretary' | 'defender', RoleTally>>>>>;
}
