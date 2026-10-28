import { describe, expect, it } from 'vitest';
import { matchStanding } from '@shared/rules/match-standing';
import { matchFacts } from '@shared/stats';
import { countAccountMatch, countGameMatch } from '@shared/stats/accumulate';
import type { AccountStats, GameStats, GameType, MatchResult, PlayerStats, Seat } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';
import { gameStatisticsRules } from '../../../client/src/games/statistics-registry';
import { ROLE_BASELINE_MIN, serverStatistics } from '../../../client/src/player-stats';

function counted(stats: { game: GameStats | null; account: AccountStats | null }, result: MatchResult, seat: Seat, at: number,
  logged = false): void {
  const match = { gameType: result.gameType, matchId: `m${at}`, at, standing: matchStanding(result, seat)!,
    facts: matchFacts(result, seat, null), logged, since: null };
  stats.game = countGameMatch(stats.game, match);
  stats.account = countAccountMatch(stats.account, match);
}

const napoleon = (seat: 'N' | 'S' | 'E', won: boolean): MatchResult => ({ gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'],
  contract: { level: 12, suit: 'spades', napoleon: 'N' }, secretaryCard: { suit: 'hearts', rank: 14 }, secretarySeat: 'S',
  points: { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, discards: [], discardPoints: 0,
  napoleonPoints: won === (seat !== 'E') ? 12 : 4, defenderPoints: 0, napoleonWins: won === (seat !== 'E'),
  winners: won === (seat !== 'E') ? ['N', 'S'] : ['E', 'W', 'P5'] });

function playerStats(games: GameStats[], account: AccountStats | null, roles: PlayerStats['napoleonRoles']['all'] = {}): PlayerStats {
  return { version: 1, scopes: { human: { account: null, games: [] }, all: { account, games } }, napoleonRoles: { human: {}, all: roles } };
}

describe('server statistics view', () => {
  it('derives rates, chance levels, places and loss averages from the counters', () => {
    const stats: { game: GameStats | null; account: AccountStats | null } = { game: null, account: null };
    const win: MatchResult = { gameType: 'sevens', penalties: { N: 0, E: 10, S: 20, W: 30 }, covered: { N: [], E: [], S: [], W: [] },
      winners: ['N'] };
    const loss: MatchResult = { ...win, penalties: { N: 12, E: 0, S: 20, W: 30 }, winners: ['E'],
      covered: { N: [{ suit: 'clubs', rank: 12 }], E: [], S: [], W: [] } };
    counted(stats, win, 'N', 1);
    counted(stats, loss, 'N', 2);
    const view = serverStatistics(playerStats([stats.game!], stats.account), 'all');
    const sevens = view.games.find((game) => game.gameType === 'sevens')!;
    expect(sevens).toMatchObject({ matches: 2, wins: 1, winRate: 0.5, expectedWinRate: 0.25, averageRank: 1.5,
      expectedAverageRank: 2.5, topTwoRate: 1, averageScore: 6, lossAverageScore: 12, rankCounts: [1, 1, 0, 0] });
    expect(sevens.records.find((record) => record.id === 'clean')).toMatchObject({ value: 1, mark: { matchId: 'm1' }, since: null });
    // No logged match yet: log records have no value.
    expect(sevens.records.find((record) => record.id === 'slays')).toMatchObject({ value: null, source: 'log' });
    expect(view).toMatchObject({ matches: 2, allMatches: 2, humanMatches: 0, bestStreak: 1, currentStreak: 0,
      topGame: 'sevens', recordsSince: null, since: null });
    expect(view.recent.map((entry) => entry.outcome)).toEqual(['win', 'loss']);
  });

  it('weights the Napoleon chance level by role with server-wide results, falling back to a coin flip', () => {
    const stats: { game: GameStats | null; account: AccountStats | null } = { game: null, account: null };
    counted(stats, napoleon('N', true), 'N', 1);
    counted(stats, napoleon('E', false), 'E', 2);
    const roles = { napoleon: { played: ROLE_BASELINE_MIN, won: ROLE_BASELINE_MIN * 0.8 }, defender: { played: 5, won: 5 } };
    const game = serverStatistics(playerStats([stats.game!], stats.account, roles), 'all').games
      .find((entry) => entry.gameType === 'napoleon')!;
    expect(game.roles).toEqual({ napoleon: { played: 1, won: 1 }, defender: { played: 1, won: 0 } });
    // Napoleon 80% from enough matches; defender 50% because five matches are too few.
    expect(game.expectedWinRate).toBeCloseTo((0.8 + 0.5) / 2);
  });

  it('dates log records from their first logged match', () => {
    const stats: { game: GameStats | null; account: AccountStats | null } = { game: null, account: null };
    const result: MatchResult = { gameType: 'redpoints', points: { N: 50, E: 40, S: 30, W: 20 }, winners: ['N'] };
    counted(stats, result, 'N', 1);
    counted(stats, result, 'N', 5, true);
    const game = serverStatistics(playerStats([stats.game!], stats.account), 'all').games.find((entry) => entry.gameType === 'redpoints')!;
    expect(game.records.find((record) => record.id === 'heartAces')).toMatchObject({ value: 0, since: 5 });
    expect(game.records.find((record) => record.id === 'topPoints')).toMatchObject({ value: 50, since: null });
  });
});

function counters(gameType: GameType, values: Partial<GameStats> = {}): GameStats {
  return { gameType, version: 1, since: null, versionSince: {}, matches: 4, wins: 1, ties: 0,
    ranks: [], tables: { 2: 2, 4: 2 }, counts: {}, sums: {}, best: {}, latest: {},
    streak: { current: 0, best: 1 }, logged: 0, logSince: null, lastAt: 10, ...values };
}

describe('per-game statistics hooks', () => {
  it.each([
    ['bridge', { 'won.declarer': 1, 'won.partner': 1 }, { overtricks: 3 },
      { id: 'overtricks', value: 1.5, format: 'signed', basis: 2 }],
    ['ninetynine', { firstOut: 1 }, {}, { id: 'firstOut', value: 0.25, format: 'rate', basis: 4 }],
    ['chinesepoker', { fouls: 2 }, {}, { id: 'fouls', value: 0.5, format: 'rate', basis: 4 }],
    ['liarsdeck', {}, { shots: 5 }, { id: 'shots', value: 1.25, format: 'decimal', basis: 4 }],
    ['blackjack', { busts: 3, handsPlayed: 10 }, {}, { id: 'busts', value: 0.3, format: 'rate', basis: 10 }],
    ['holdem', { showdownWins: 2, showdowns: 5 }, {}, { id: 'showdownWins', value: 0.4, format: 'rate', basis: 5 }],
  ] as const)('keeps the %s metric and its denominator', (gameType, counts, sums, expected) => {
    const view = serverStatistics(playerStats([counters(gameType, { counts, sums })], null), 'all');
    expect(view.games.find((game) => game.gameType === gameType)?.metrics).toEqual([expected]);
  });

  it.each(['bridge', 'blackjack', 'holdem'] as const)('omits %s metrics without any denominator observations', (gameType) => {
    const view = serverStatistics(playerStats([counters(gameType)], null), 'all');
    expect(view.games.find((game) => game.gameType === gameType)?.metrics).toEqual([]);
  });

  it('keeps table-size chance levels in ranking games and a coin flip for Bridge', () => {
    for (const gameType of GAME_TYPES.filter((game) => game !== 'napoleon')) {
      const view = serverStatistics(playerStats([counters(gameType)], null), 'all');
      expect(view.games.find((game) => game.gameType === gameType)?.expectedWinRate)
        .toBe(gameType === 'bridge' ? 0.5 : 0.375);
    }
  });

  it('keeps Bridge role groups and Napoleon role order without grouping defenders as declarers', () => {
    expect(gameStatisticsRules('bridge').roleMetrics).toEqual([
      { label: 'history.stats.bridge.declarerSide', roles: ['declarer', 'partner'] },
      { label: 'history.stats.bridge.declarer', roles: ['declarer'] },
      { label: 'history.stats.bridge.defender', roles: ['defender'] },
    ]);
    expect(gameStatisticsRules('napoleon').roleMetrics).toEqual([
      { label: 'history.stats.role.napoleon', roles: ['napoleon'] },
      { label: 'history.stats.role.secretary', roles: ['secretary'] },
      { label: 'history.stats.role.defender', roles: ['defender'] },
    ]);
  });
});
