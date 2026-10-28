import { GAME_TYPES } from '@shared/constants';
import type { StandingRole } from '@shared/rules/match-standing';
import { STATS_RECORDS } from '@shared/stats/definitions';
import type { StatsRecordDefinition } from '@shared/stats/definitions';
import type { GameStats, GameType, PlayerStats, RoleTally, StatsScope } from '@shared/types';
import { SCORE_KINDS } from './match-statistics';
import type { GameMetric, GameStatistics, MatchStatistics, RoleRecord, SpecialRecord } from './match-statistics';

/** Role baselines need this many Napoleon matches server-wide; fewer fall back to a coin flip. */
export const ROLE_BASELINE_MIN = 20;

const ROLES: readonly StandingRole[] = ['declarer', 'partner', 'napoleon', 'secretary', 'defender'];
const PENALTY_GAMES: ReadonlySet<GameType> = new Set(['bigtwo', 'sevens']);

function ratio(value: number, total: number): number | null {
  return total > 0 ? value / total : null;
}

function emptyGame(gameType: GameType): GameStatistics {
  return { gameType, matches: 0, wins: 0, ties: 0, winRate: null, expectedWinRate: null, averageRank: null,
    expectedAverageRank: null, topTwoRate: null, topTwoCount: 0, rankCounts: [], scoreKind: SCORE_KINDS[gameType] ?? null,
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

/**
 * Chance of winning: one in the seats of a ranking game, a coin flip for Bridge sides, and for Napoleon
 * every role weighted by how often that role wins across all players.
 */
function expectedWins(stats: GameStats, roles: Partial<Record<StandingRole, RoleRecord>>,
  baselines: Readonly<Partial<Record<string, RoleTally>>>): number {
  if (stats.gameType === 'bridge') return stats.matches / 2;
  if (stats.gameType === 'napoleon') {
    return Object.entries(roles).reduce((sum, [role, record]) => {
      const baseline = baselines[role];
      const rate = baseline && baseline.played >= ROLE_BASELINE_MIN ? baseline.won / baseline.played : 0.5;
      return sum + record.played * rate;
    }, 0);
  }
  return Object.entries(stats.tables).reduce((sum, [players, count]) => sum + count / Number(players), 0);
}

function metrics(stats: GameStats): GameMetric[] {
  const { counts, sums, matches } = stats;
  const list: GameMetric[] = [];
  const declaringWins = (counts['won.declarer'] ?? 0) + (counts['won.partner'] ?? 0);
  if (stats.gameType === 'bridge' && declaringWins > 0) {
    list.push({ id: 'overtricks', value: (sums.overtricks ?? 0) / declaringWins, format: 'signed', basis: declaringWins });
  }
  if (stats.gameType === 'ninetynine') list.push({ id: 'firstOut', value: (counts.firstOut ?? 0) / matches, format: 'rate', basis: matches });
  if (stats.gameType === 'chinesepoker') list.push({ id: 'fouls', value: (counts.fouls ?? 0) / matches, format: 'rate', basis: matches });
  if (stats.gameType === 'liarsdeck') list.push({ id: 'shots', value: (sums.shots ?? 0) / matches, format: 'decimal', basis: matches });
  if (stats.gameType === 'blackjack' && (counts.handsPlayed ?? 0) > 0) {
    list.push({ id: 'busts', value: (counts.busts ?? 0) / counts.handsPlayed, format: 'rate', basis: counts.handsPlayed });
  }
  if (stats.gameType === 'holdem' && (counts.showdowns ?? 0) > 0) {
    list.push({ id: 'showdownWins', value: (counts.showdownWins ?? 0) / counts.showdowns, format: 'rate', basis: counts.showdowns });
  }
  return list;
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
  const scoreKind = SCORE_KINDS[gameType] ?? null;
  const losses = matches - stats.wins;
  return {
    gameType, matches, wins: stats.wins, ties: stats.ties,
    winRate: ratio(stats.wins, matches),
    expectedWinRate: ratio(expectedWins(stats, roles, baselines), matches),
    averageRank: ranked ? ratio(stats.sums.rank ?? 0, ranked) : null,
    expectedAverageRank: ranked ? ratio(expectedRankSum, ranked) : null,
    topTwoRate: ranked ? ratio(stats.counts.topTwo ?? 0, threePlus) : null,
    topTwoCount: stats.counts.topTwo ?? 0,
    rankCounts: stats.ranks,
    scoreKind,
    averageScore: scoreKind ? ratio(stats.sums.score ?? 0, matches) : null,
    roles,
    lossAverageScore: PENALTY_GAMES.has(gameType) ? ratio(stats.sums.lossScore ?? 0, losses) : null,
    metrics: metrics(stats),
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
