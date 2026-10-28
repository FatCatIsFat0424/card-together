import { GAME_TYPES } from '@shared/constants';
import type { StandingRole } from '@shared/rules/match-standing';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { StatsRecordDefinition } from '@shared/stats/definitions';
import type { GameStats, GameType, PlayerStats, RoleTally, StatsScope } from '@shared/types';
import { gameDefinition } from '@shared/games/registry';
import { gameStatisticsRules } from './games/statistics-registry';
import type { GameStatistics, MatchStatistics, RoleRecord, SpecialRecord } from './match-statistics';

export { ROLE_BASELINE_MIN } from './games/napoleon/statistics';

const ROLES: readonly StandingRole[] = ['declarer', 'partner', 'napoleon', 'secretary', 'defender'];

function ratio(value: number, total: number): number | null {
  return total > 0 ? value / total : null;
}

function emptyGame(gameType: GameType): GameStatistics {
  return { gameType, matches: 0, wins: 0, ties: 0, winRate: null, expectedWinRate: null, averageRank: null,
    expectedAverageRank: null, topTwoRate: null, topTwoCount: 0, rankCounts: [], scoreKind: gameDefinition(gameType).result.scoreKind,
    averageScore: null, roles: {}, lossAverageScore: null, metrics: [], records: [] };
}

function roleRecords(stats: GameStats): Partial<Record<StandingRole, RoleRecord>> {
  const roles: Partial<Record<StandingRole, RoleRecord>> = {};
  for (const role of ROLES) {
    const played = stats.counts[`role.${role}`] ?? 0;
    if (played > 0) roles[role] = { played, won: stats.counts[`won.${role}`] ?? 0 };
  }
  return roles;
}

/** Where a record's counting started, or null when it covers every counted match. */
function recordSince(stats: GameStats, definition: StatsRecordDefinition): number | null {
  // A record newer than the stored counters starts with the next counted match.
  if (definition.version > stats.version) return stats.lastAt;
  const starts = [stats.since, definition.version > 1 ? stats.versionSince[String(definition.version)] ?? null : null,
    definition.source === 'log' ? stats.logSince : null].filter((value): value is number => value !== null);
  return starts.length > 0 ? Math.max(...starts) : null;
}

function specialRecords(stats: GameStats): SpecialRecord[] {
  return STATS_RECORDS[stats.gameType].map((definition) => {
    const tracked = definition.version <= stats.version && (definition.source === 'result' || stats.logged > 0);
    const best = stats.best[definition.id];
    const value = !tracked ? null
      : definition.kind === 'count' ? stats.counts[definition.id] ?? 0
        : definition.kind === 'total' ? stats.sums[definition.id] ?? 0
          : best?.value ?? null;
    return { id: definition.id, source: definition.source, kind: definition.kind, remember: definition.remember === true,
      tracked, value, mark: definition.kind === 'max' || definition.kind === 'min' ? best ?? null : stats.latest[definition.id] ?? null,
      since: recordSince(stats, definition) };
  });
}

function gameStatistics(stats: GameStats, baselines: Readonly<Partial<Record<string, RoleTally>>>): GameStatistics {
  const { matches, gameType } = stats;
  const roles = roleRecords(stats);
  const ranked = stats.ranks.reduce((sum, count) => sum + count, 0);
  const expectedRankSum = Object.entries(stats.tables).reduce((sum, [players, count]) => sum + count * (Number(players) + 1) / 2, 0);
  const threePlus = Object.entries(stats.tables).reduce((sum, [players, count]) => sum + (Number(players) > 2 ? count : 0), 0);
  const scoreKind = gameDefinition(gameType).result.scoreKind;
  const losses = matches - stats.wins;
  return {
    gameType, matches, wins: stats.wins, ties: stats.ties,
    winRate: ratio(stats.wins, matches),
    expectedWinRate: ratio(gameStatisticsRules(gameType).expectedWins(stats, baselines), matches),
    averageRank: ranked ? ratio(stats.sums.rank ?? 0, ranked) : null,
    expectedAverageRank: ranked ? ratio(expectedRankSum, ranked) : null,
    topTwoRate: ranked ? ratio(stats.counts.topTwo ?? 0, threePlus) : null,
    topTwoCount: stats.counts.topTwo ?? 0,
    rankCounts: stats.ranks,
    scoreKind,
    averageScore: scoreKind ? ratio(stats.sums.score ?? 0, matches) : null,
    roles,
    lossAverageScore: scoreKind === 'penalty' ? ratio(stats.sums.lossScore ?? 0, losses) : null,
    metrics: gameStatisticsRules(gameType).metrics(stats),
    records: specialRecords(stats),
  };
}

/** The statistics views' shape from the server's accumulated counters in `scope`. */
export function serverStatistics(stats: PlayerStats, scope: StatsScope): MatchStatistics {
  const counters = stats.scopes[scope];
  const byGame = new Map(counters.games.map((game) => [game.gameType, game]));
  const games = GAME_TYPES.map((gameType) => {
    const game = byGame.get(gameType);
    return game ? gameStatistics(game, stats.napoleonRoles[scope]) : emptyGame(gameType);
  });
  const total = (value: StatsScope): number => stats.scopes[value].games.reduce((sum, game) => sum + game.matches, 0);
  const matches = total(scope);
  const wins = games.reduce((sum, game) => sum + game.wins, 0);
  const top = games.reduce<GameStatistics | null>((best, game) => game.matches > (best?.matches ?? 0) ? game : best, null);
  const recordStarts = games.flatMap((game) => game.matches > 0 ? game.records.flatMap((record) => record.since ?? []) : []);
  const account = counters.account;
  return {
    scope, matches, humanMatches: total('human'), allMatches: total('all'), wins,
    ties: games.reduce((sum, game) => sum + game.ties, 0),
    winRate: ratio(wins, matches),
    recent: (account?.recent ?? []).map((entry) => ({ gameType: entry.gameType, finishedAt: entry.at, outcome: entry.outcome })),
    bestStreak: account?.streak.best ?? 0,
    currentStreak: account?.streak.current ?? 0,
    topGame: top?.gameType ?? null, topGameMatches: top?.matches ?? 0, games,
    since: account?.since ?? null,
    recordsSince: recordStarts.length > 0 ? Math.max(...recordStarts) : null,
  };
}
