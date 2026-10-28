import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchResult, MatchSummary } from '@shared/types';
import { GAME_TYPES } from '@shared/constants';

vi.mock('../../../client/src/socket', () => ({ socket: {} }));
vi.mock('../../../client/src/api', () => ({ apiRequest: vi.fn() }));
vi.mock('../../../client/src/deployment', () => ({ API_BASE_URL: '', APP_BASE_PATH: '/' }));

import { MatchStatsStrip } from '../../../client/src/components/MatchStatsStrip';
import { matchStatistics, readStatsScope } from '../../../client/src/match-statistics';
import { useI18nStore } from '../../../client/src/stores/i18n-store';

const humans = ['me', 'a', 'b', 'c'];
const withBot = ['me', 'bot:east', 'b', 'c'];
let clock = 0;
function match(result: MatchResult, accountIds: readonly string[] = humans): MatchSummary {
  clock += 1000;
  return { id: `m${clock}`, roomCode: `R${clock}`, accountIds, result, finishedAt: clock };
}
const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
const bigTwo = (winnerSeat: 'N' | 'E', scores: { N: number; E: number; S: number; W: number }): MatchResult => ({
  gameType: 'bigtwo', winnerSeat, dragon: false, cardsLeft: scores, twosLeft: { N: 0, E: 0, S: 0, W: 0 }, scores });
const redPoints = (winners: ('N' | 'E')[]): MatchResult => ({
  gameType: 'redpoints', points: { N: winners.includes('N') ? 80 : 40, E: winners.includes('E') ? 80 : 40, S: 24, W: 10 }, winners });
const bridge = (declarer: 'N' | 'E', declarerTeamWins: boolean): MatchResult => ({
  gameType: 'bridge', contract: { level: 3, suit: 'nt', declarer }, declarerTeamTricks: 9, defenderTeamTricks: 4,
  requiredTricks: 9, declarerTeamWins });
const napoleon = (napoleonSeat: 'N' | 'E', secretarySeat: 'S' | null, napoleonWins: boolean): MatchResult => ({
  gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'], contract: { level: 13, suit: 'hearts', napoleon: napoleonSeat },
  secretarySeat, points: zero, discards: [], discardPoints: 0, napoleonPoints: 14, defenderPoints: 6, napoleonWins,
  winners: napoleonWins ? [napoleonSeat, ...(secretarySeat ? [secretarySeat] : [])] : ['N', 'E', 'S', 'W', 'P5'].filter((seat) =>
    seat !== napoleonSeat && seat !== secretarySeat) } as unknown as MatchResult);

const game = (statistics: ReturnType<typeof matchStatistics>, type: string) =>
  statistics.games.find((entry) => entry.gameType === type)!;

describe('match statistics scope', () => {
  const matches = [
    match(bigTwo('N', { N: 0, E: 4, S: 7, W: 9 })),
    match(bigTwo('E', { N: 3, E: 0, S: 7, W: 9 }), withBot),
  ];

  it('counts only matches without bots by default and every match in the all scope', () => {
    const human = matchStatistics(matches, 'me', 'human');
    expect(human).toMatchObject({ matches: 1, humanMatches: 1, allMatches: 2, wins: 1, winRate: 1 });
    const all = matchStatistics(matches, 'me', 'all');
    expect(all).toMatchObject({ matches: 2, humanMatches: 1, allMatches: 2, wins: 1, winRate: 0.5 });
    expect(all.games.map((entry) => entry.gameType)).toEqual(GAME_TYPES);
  });

  it('ignores matches the account did not play and leaves unplayed games without rates', () => {
    const stranger = matchStatistics(matches, 'visitor', 'all');
    expect(stranger).toMatchObject({ matches: 0, allMatches: 0, winRate: null, topGame: null, recent: [] });
    expect(stranger.games.every((entry) => entry.matches === 0 && entry.winRate === null && entry.averageRank === null)).toBe(true);
  });

  it('keeps every bot match out of the human-only scope but reports how many were left out', () => {
    const botsOnly = matchStatistics([matches[1]], 'me', 'human');
    expect(botsOnly).toMatchObject({ matches: 0, humanMatches: 0, allMatches: 1, winRate: null });
  });

  it('defaults to the human-only scope when nothing is stored', () => {
    expect(readStatsScope()).toBe('human');
  });
});

describe('ranking game statistics', () => {
  it('counts a tie for first as a win and reports the ties separately', () => {
    const statistics = matchStatistics([match(redPoints(['N', 'E'])), match(redPoints(['E'])), match(redPoints(['N']))], 'me', 'all');
    expect(game(statistics, 'redpoints')).toMatchObject({ matches: 3, wins: 2, ties: 1, topTwoCount: 3 });
    expect(statistics).toMatchObject({ wins: 2, ties: 1 });
    expect(statistics.recent.map((item) => item.outcome)).toEqual(['tie', 'loss', 'win']);
  });

  it('derives chance levels, average place and the place distribution', () => {
    const statistics = matchStatistics([
      match(bigTwo('N', { N: 0, E: 4, S: 7, W: 9 })), match(bigTwo('E', { N: 3, E: 0, S: 7, W: 9 })),
      match(bigTwo('E', { N: 12, E: 0, S: 7, W: 9 })),
    ], 'me', 'all');
    expect(game(statistics, 'bigtwo')).toMatchObject({
      matches: 3, wins: 1, expectedWinRate: 0.25, expectedAverageRank: 2.5, rankCounts: [1, 1, 0, 1],
      scoreKind: 'penalty', topTwoRate: 2 / 3,
    });
    expect(game(statistics, 'bigtwo').averageRank).toBeCloseTo((1 + 2 + 4) / 3);
    expect(game(statistics, 'bigtwo').averageScore).toBeCloseTo(5);
  });

  it('skips the top-two rate at two-seat tables', () => {
    const headsUp = match({ gameType: 'holdem', seats: ['N', 'E'], hands: 9, chips: { ...zero, N: 2000 },
      winners: ['N'], eliminationOrder: ['E'] } as unknown as MatchResult, ['me', 'a']);
    expect(game(matchStatistics([headsUp], 'me', 'all'), 'holdem')).toMatchObject({
      topTwoRate: null, expectedWinRate: 0.5, rankCounts: [1, 0], scoreKind: 'chips', averageScore: 1000 });
  });
});

describe('side game statistics', () => {
  it('splits Bridge into declarer, partner and defender records against a 50% chance level', () => {
    const statistics = matchStatistics([
      match(bridge('N', true)), match(bridge('N', false)), match(bridge('E', true)), match({ ...bridge('E', false) }),
    ], 'me', 'all');
    const stats = game(statistics, 'bridge');
    expect(stats).toMatchObject({ matches: 4, wins: 2, expectedWinRate: 0.5, rankCounts: [], averageRank: null });
    expect(stats.roles).toEqual({ declarer: { played: 2, won: 1 }, defender: { played: 2, won: 1 } });
  });

  it('counts a Napoleon win per role, with the secretary on the winning side', () => {
    const statistics = matchStatistics([
      match(napoleon('N', 'S', true)), match(napoleon('E', null, true)), match(napoleon('E', null, false)),
    ], 'me', 'all');
    expect(game(statistics, 'napoleon')).toMatchObject({ matches: 3, wins: 2, expectedWinRate: 0.5,
      roles: { napoleon: { played: 1, won: 1 }, defender: { played: 2, won: 1 } } });
    const asSecretary = matchStatistics([match(napoleon('E', 'S', true), ['a', 'b', 'me', 'c', 'd'])], 'me', 'all');
    expect(game(asSecretary, 'napoleon').roles).toEqual({ secretary: { played: 1, won: 1 } });
  });
});

describe('streaks and the profile strip', () => {
  const results: MatchResult[] = [
    bigTwo('N', { N: 0, E: 4, S: 7, W: 9 }), redPoints(['N', 'E']), bridge('N', true),
    bigTwo('E', { N: 3, E: 0, S: 7, W: 9 }), bridge('N', true), bigTwo('N', { N: 0, E: 4, S: 7, W: 9 }),
  ];
  // Newest first, as the history API returns them; the statistics order them by time.
  const matches = results.map((result) => match(result)).reverse();

  it('counts consecutive wins, tied first places included, and lists the latest ten oldest first', () => {
    const statistics = matchStatistics(matches, 'me', 'all');
    expect(statistics).toMatchObject({ bestStreak: 3, currentStreak: 2, topGame: 'bigtwo', topGameMatches: 3 });
    expect(statistics.recent.map((item) => item.outcome)).toEqual(['win', 'tie', 'win', 'loss', 'win', 'win']);
    const many = Array.from({ length: 14 }, () => match(bridge('N', true)));
    expect(matchStatistics(many, 'me', 'all').recent).toHaveLength(10);
  });

  beforeEach(() => useI18nStore.getState().setLocale('zh-TW'));

  const render = (statistics: ReturnType<typeof matchStatistics>, wide: boolean): string => renderToStaticMarkup(
    createElement(MatchStatsStrip, { statistics, wide, scope: statistics.scope, onScopeChange: () => undefined, onOpen: () => undefined }));

  it('shows the figures, the scope switch and ten dots on desktop, and one pill on narrow screens', () => {
    const statistics = matchStatistics(matches, 'me', 'all');
    const wide = render(statistics, true);
    expect(wide).toContain('只算真人');
    expect(wide).toContain('83%');
    expect(wide.match(/<i /g)).toHaveLength(6);
    const pill = render(statistics, false);
    expect(pill).toContain('6 場');
    expect(pill).not.toContain('只算真人');
  });

  it('says so, and offers the bot matches, when only matches with bots exist', () => {
    const botsOnly = matchStatistics([match(bridge('N', true), withBot)], 'me', 'human');
    const html = render(botsOnly, true);
    expect(html).toContain('沒有純真人對局（含電腦 1 場）');
    expect(html).toContain('改看全部');
    expect(render(matchStatistics([], 'me', 'human'), true)).toBe('');
  });
});
