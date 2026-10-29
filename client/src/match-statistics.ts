import type { GameType, MatchSummary, StatsMark, StatsScope } from '@shared/types';
import type { StatsRecordKind, StatsSource } from '@shared/stats/definitions';
import { GAME_TYPES } from '@shared/constants';
import { gameDefinition } from '@shared/games/registry';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import type { MatchStanding, StandingRole } from '@shared/rules/match-standing';
import { readPreference, writePreference } from './utils/preference-storage';

/** Human-only matches are the default; `all` also counts matches played against bots. */
export type { StatsScope };
export type RecentOutcome = 'win' | 'loss' | 'tie';

/** What the figure of a game's `averageScore` is: penalty and chips are signed against the starting position. */
export type ScoreKind = 'penalty' | 'points' | 'chips';

export interface RoleRecord {
  readonly played: number;
  readonly won: number;
}

/** A game-specific figure beside the common ones. */
export interface GameMetric {
  readonly id: 'overtricks' | 'firstOut' | 'fouls' | 'shots' | 'busts' | 'showdownWins' | 'diceLost' | 'jokerLosses' | 'accuracy';
  /** A rate (0–1) or an average */
  readonly value: number;
  readonly format: 'rate' | 'decimal' | 'signed';
  /** Matches or hands the figure is based on */
  readonly basis: number;
}

/** A special record of one game, with where its counting started when history is incomplete. */
export interface SpecialRecord {
  readonly id: string;
  readonly source: StatsSource;
  readonly kind: StatsRecordKind;
  readonly remember: boolean;
  /** False for log records before any logged match, and for records newer than the stored counters */
  readonly tracked: boolean;
  /** Null when untracked, or before any counted match reached a best value */
  readonly value: number | null;
  /** The match that set a best value, or the latest match of a remembered count */
  readonly mark: StatsMark | null;
  /** Counting started here; null when it covers every counted match */
  readonly since: number | null;
}

export interface GameStatistics {
  readonly gameType: GameType;
  readonly matches: number;
  /** First place, ties included, or the winning side */
  readonly wins: number;
  /** Matches tied for first place; they are also counted in `wins` */
  readonly ties: number;
  readonly winRate: number | null;
  /** Win rate a player would have by chance: one in the seats of a ranking game, one half for sides */
  readonly expectedWinRate: number | null;
  /** Ranking games only */
  readonly averageRank: number | null;
  readonly expectedAverageRank: number | null;
  /** Tables of three or more seats only; with two seats every player is always in the top two */
  readonly topTwoRate: number | null;
  readonly topTwoCount: number;
  /** Matches finished at rank 1, 2, ... (index 0 is first); empty for side games */
  readonly rankCounts: readonly number[];
  readonly scoreKind: ScoreKind | null;
  readonly averageScore: number | null;
  /** Bridge and Napoleon: how the account fared in each role it held */
  readonly roles: Readonly<Partial<Record<StandingRole, RoleRecord>>>;
  /** Penalty games: the average penalty of the matches not won */
  readonly lossAverageScore: number | null;
  readonly metrics: readonly GameMetric[];
  /** Empty without server statistics */
  readonly records: readonly SpecialRecord[];
}

export interface RecentResult {
  readonly gameType: GameType;
  readonly finishedAt: number;
  readonly outcome: RecentOutcome;
}

/**
 * Everything the statistics views show. The views read only this shape, so a server-side counter
 * source can replace `matchStatistics` without touching them.
 */
export interface MatchStatistics {
  readonly scope: StatsScope;
  /** Matches counted in this scope */
  readonly matches: number;
  /** Matches without a bot seat and all matches, whichever scope is shown */
  readonly humanMatches: number;
  readonly allMatches: number;
  readonly wins: number;
  readonly ties: number;
  readonly winRate: number | null;
  /** Oldest first, at most ten */
  readonly recent: readonly RecentResult[];
  readonly bestStreak: number;
  readonly currentStreak: number;
  /** Most played game; the first game in registry order wins a tie */
  readonly topGame: GameType | null;
  readonly topGameMatches: number;
  readonly games: readonly GameStatistics[];
  /** Server statistics: counting started here because older results were pruned; null when complete */
  readonly since: number | null;
  /** Server statistics: the latest start of any played game's special records; null when all are complete */
  readonly recordsSince: number | null;
}

const RECENT_COUNT = 10;

export function isHumanMatch(match: MatchSummary): boolean {
  return !match.accountIds.some((id) => id.startsWith('bot:'));
}

/** How the account finished the match, or null when it did not take part. */
export function accountStanding(match: MatchSummary, accountId?: string): MatchStanding | null {
  const index = accountId ? match.accountIds.indexOf(accountId) : -1;
  // accountIds follow the recorded seats; Blackjack and Hold'em may record fewer than four
  const seat = matchSeats(match.result)[index];
  return seat ? matchStanding(match.result, seat) : null;
}

interface Tally {
  matches: number;
  wins: number;
  ties: number;
  rankCounts: number[];
  rankSum: number;
  ranked: number;
  expectedRankSum: number;
  topTwo: number;
  threePlus: number;
  expectedWins: number;
  scoreSum: number;
  scored: number;
  roles: Partial<Record<StandingRole, { played: number; won: number }>>;
}

function emptyTally(): Tally {
  return { matches: 0, wins: 0, ties: 0, rankCounts: [], rankSum: 0, ranked: 0, expectedRankSum: 0, topTwo: 0,
    threePlus: 0, expectedWins: 0, scoreSum: 0, scored: 0, roles: {} };
}

function addToTally(tally: Tally, standing: MatchStanding): void {
  tally.matches += 1;
  if (standing.won) tally.wins += 1;
  if (standing.role) {
    const record = tally.roles[standing.role] ?? { played: 0, won: 0 };
    record.played += 1;
    if (standing.won) record.won += 1;
    tally.roles[standing.role] = record;
  }
  if (standing.score !== null) { tally.scoreSum += standing.score; tally.scored += 1; }
  if (standing.rank === null) { tally.expectedWins += 0.5; return; }
  if (standing.won && standing.tied) tally.ties += 1;
  tally.expectedWins += 1 / standing.players;
  tally.ranked += 1;
  tally.rankSum += standing.rank;
  tally.expectedRankSum += (standing.players + 1) / 2;
  while (tally.rankCounts.length < standing.players) tally.rankCounts.push(0);
  tally.rankCounts[standing.rank - 1] += 1;
  if (standing.players > 2) {
    tally.threePlus += 1;
    if (standing.rank <= 2) tally.topTwo += 1;
  }
}

function gameStatistics(gameType: GameType, tally: Tally): GameStatistics {
  const { matches } = tally;
  return {
    gameType, matches, wins: tally.wins, ties: tally.ties,
    winRate: matches ? tally.wins / matches : null,
    expectedWinRate: matches ? tally.expectedWins / matches : null,
    averageRank: tally.ranked ? tally.rankSum / tally.ranked : null,
    expectedAverageRank: tally.ranked ? tally.expectedRankSum / tally.ranked : null,
    topTwoRate: tally.threePlus ? tally.topTwo / tally.threePlus : null,
    topTwoCount: tally.topTwo,
    rankCounts: tally.rankCounts,
    scoreKind: gameDefinition(gameType).result.scoreKind,
    averageScore: tally.scored ? tally.scoreSum / tally.scored : null,
    roles: tally.roles,
    lossAverageScore: null, metrics: [], records: [],
  };
}

/** Compute the statistics of the loaded matches in `scope`; the caller picks the data source. */
export function matchStatistics(
  matches: readonly MatchSummary[], accountId: string | undefined, scope: StatsScope,
): MatchStatistics {
  const tallies = new Map<GameType, Tally>(GAME_TYPES.map((type) => [type, emptyTally()]));
  const counted: { readonly match: MatchSummary; readonly standing: MatchStanding }[] = [];
  let humanMatches = 0;
  let allMatches = 0;
  for (const match of matches) {
    const standing = accountStanding(match, accountId);
    if (!standing) continue;
    allMatches += 1;
    const human = isHumanMatch(match);
    if (human) humanMatches += 1;
    if (scope === 'human' && !human) continue;
    counted.push({ match, standing });
    addToTally(tallies.get(match.result.gameType)!, standing);
  }
  const chronological = counted.toSorted((first, second) => first.match.finishedAt - second.match.finishedAt);
  let bestStreak = 0;
  let currentStreak = 0;
  for (const { standing } of chronological) {
    currentStreak = standing.won ? currentStreak + 1 : 0;
    bestStreak = Math.max(bestStreak, currentStreak);
  }
  const games = GAME_TYPES.map((type) => gameStatistics(type, tallies.get(type)!));
  const top = games.reduce<GameStatistics | null>((best, game) =>
    game.matches > (best?.matches ?? 0) ? game : best, null);
  const wins = games.reduce((sum, game) => sum + game.wins, 0);
  return {
    scope, matches: counted.length, humanMatches, allMatches, wins,
    ties: games.reduce((sum, game) => sum + game.ties, 0),
    winRate: counted.length ? wins / counted.length : null,
    recent: chronological.slice(-RECENT_COUNT).map(({ match, standing }) => ({
      gameType: match.result.gameType, finishedAt: match.finishedAt,
      outcome: !standing.won ? 'loss' : standing.rank !== null && standing.tied ? 'tie' : 'win',
    })),
    bestStreak, currentStreak, topGame: top?.gameType ?? null, topGameMatches: top?.matches ?? 0, games,
    since: null, recordsSince: null,
  };
}

const SCOPE_KEY = 'history-stats-scope';

export function readStatsScope(): StatsScope {
  return readPreference(SCOPE_KEY) === 'all' ? 'all' : 'human';
}

export function writeStatsScope(scope: StatsScope): void {
  writePreference(SCOPE_KEY, scope === 'human' ? null : scope);
}
