import { describe, expect, it } from 'vitest';
import type { MatchSummary, PublicAccount } from '@shared/types';
import { matchOutcome, selectHistoryMatches } from '../../../client/src/match-history';
import type { HistoryFilters } from '../../../client/src/match-history';

const participants = ['north', 'east', 'south', 'west'];
const bridge: MatchSummary = {
  id: 'bridge', roomCode: 'ROOM10', accountIds: participants, finishedAt: 300,
  result: { gameType: 'bridge', contract: { level: 4, suit: 'spades', declarer: 'N' },
    declarerTeamTricks: 10, defenderTeamTricks: 3, requiredTricks: 10, declarerTeamWins: true },
};
const tie: MatchSummary = {
  id: 'tie', roomCode: 'ROOM2', accountIds: participants, finishedAt: 200,
  result: { gameType: 'redpoints', points: { N: 80, E: 80, S: 24, W: 24 }, winners: ['N', 'E'] },
};
const loss: MatchSummary = {
  id: 'loss', roomCode: 'ROOM1', accountIds: participants, finishedAt: 100,
  result: { gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 },
};
const players: Record<string, PublicAccount> = {
  north: { id: 'north', username: 'Nora_Chen', nickname: '小諾', avatar: 'cat', color: '#abcdef', avatarImage: null },
};
const filters: HistoryFilters = {
  accountId: 'north', query: '', gameType: 'all', outcome: 'all', sortKey: 'date', direction: 'desc',
  locale: 'en', gameName: (type) => type === 'redpoints' ? 'Red Points' : type,
  outcomeName: (outcome) => outcome,
};

describe('history outcomes', () => {
  it('assigns the declaring partnership and defenders their correct outcomes', () => {
    expect(participants.map((id) => matchOutcome(bridge, id))).toEqual(['win', 'loss', 'win', 'loss']);
    const down: MatchSummary = { ...bridge, result: {
      gameType: 'bridge', contract: { level: 3, suit: 'nt', declarer: 'E' }, declarerTeamTricks: 8,
      defenderTeamTricks: 5, requiredTricks: 9, declarerTeamWins: false } };
    expect(participants.map((id) => matchOutcome(down, id))).toEqual(['win', 'loss', 'win', 'loss']);
    const eastWins: MatchSummary = { ...bridge, result: {
      gameType: 'bridge', contract: { level: 3, suit: 'nt', declarer: 'E' }, declarerTeamTricks: 9,
      defenderTeamTricks: 4, requiredTricks: 9, declarerTeamWins: true } };
    expect(participants.map((id) => matchOutcome(eastWins, id))).toEqual(['loss', 'win', 'loss', 'win']);
  });

  it('distinguishes tied winners, losing players, and single-seat winners', () => {
    expect(participants.map((id) => matchOutcome(tie, id))).toEqual(['tie', 'tie', 'loss', 'loss']);
    expect(participants.map((id) => matchOutcome(loss, id))).toEqual(['loss', 'loss', 'loss', 'win']);
  });

  it('does not assign a win or loss to a nonparticipant', () => {
    expect(matchOutcome(bridge, 'visitor')).toBe('completed');
    expect(matchOutcome(bridge)).toBe('completed');
  });
});

describe('frontend history controls', () => {
  const matches = Object.freeze([loss, tie, bridge]);
  const ids = (overrides: Partial<HistoryFilters>): string[] =>
    selectHistoryMatches(matches, players, { ...filters, ...overrides }).map((match) => match.id);

  it('searches room codes, nicknames, usernames, and translated games with combined terms', () => {
    expect(ids({ query: ' room2  NORA_chen ' })).toEqual(['tie']);
    expect(ids({ query: '小諾 red points' })).toEqual(['tie']);
    expect(ids({ query: 'ＲＯＯＭ１０' })).toEqual(['bridge']);
    expect(ids({ query: 'unknown' })).toEqual([]);
    expect(ids({ query: '  ' })).toEqual(['bridge', 'tie', 'loss']);
  });

  it('combines filters with search and uses the viewed account for results', () => {
    expect(ids({ gameType: 'bridge', outcome: 'win', query: 'nora' })).toEqual(['bridge']);
    expect(ids({ gameType: 'bridge', outcome: 'loss' })).toEqual([]);
    expect(ids({ gameType: 'bridge', outcome: 'loss', accountId: 'east' })).toEqual(['bridge']);
    expect(ids({ outcome: 'tie' })).toEqual(['tie']);
    expect(ids({ outcome: 'completed', accountId: 'visitor' })).toEqual(['bridge', 'tie', 'loss']);
  });

  it('sorts dates in both directions and room numbers naturally without mutating the input', () => {
    expect(ids({})).toEqual(['bridge', 'tie', 'loss']);
    expect(ids({ direction: 'asc' })).toEqual(['loss', 'tie', 'bridge']);
    expect(ids({ sortKey: 'room', direction: 'asc' })).toEqual(['loss', 'tie', 'bridge']);
    expect(ids({ sortKey: 'room', direction: 'desc' })).toEqual(['bridge', 'tie', 'loss']);
    expect(matches.map((match) => match.id)).toEqual(['loss', 'tie', 'bridge']);
  });

  it('sorts localized game and result labels with a deterministic newest-first tiebreaker', () => {
    expect(ids({ sortKey: 'game', direction: 'asc', gameName: (type) =>
      type === 'bridge' ? 'Zulu' : type === 'redpoints' ? 'Alpha' : 'Bravo' })).toEqual(['tie', 'loss', 'bridge']);
    expect(ids({ sortKey: 'result', direction: 'asc' })).toEqual(['loss', 'tie', 'bridge']);
    expect(ids({ sortKey: 'game', direction: 'asc', gameName: () => 'Same' })).toEqual(['bridge', 'tie', 'loss']);
  });
});
