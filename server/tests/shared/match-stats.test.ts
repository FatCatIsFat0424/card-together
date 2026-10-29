import { describe, expect, it } from 'vitest';
import { GAME_TYPES } from '@shared/constants';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { finalReplayFrame, matchFacts } from '@shared/stats';
import { countAccountMatch, countGameMatch } from '@shared/stats/accumulate';
import type { CountedMatch } from '@shared/stats/accumulate';
import { decodeContract, encodeContract, LOG_METRICS, STATS_RECORDS, STATS_VERSION } from '@shared/stats/definitions';
import { decodePokerHand, encodePokerHand, holdemFacts } from '@shared/stats/holdem';
import type {
  BigTwoMatchResult, Card, GameStats, MatchResult, NinetyNineMatchResult, ReplaySnapshot, Seat,
} from '@shared/types';
import { recordMatch } from '../client/replay-fixtures';

const card = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

function counted(result: MatchResult, seat: Seat, overrides: Partial<CountedMatch> = {}): CountedMatch {
  return { gameType: result.gameType, matchId: 'm1', at: 1_000, standing: matchStanding(result, seat)!,
    facts: matchFacts(result, seat, null), logged: false, since: null, ...overrides };
}

describe('match facts from real recorded matches', () => {
  it.each(GAME_TYPES)('%s: the final replay frame holds the result and only defined records', (gameType) => {
    const { replay, match, snapshots } = recordMatch(gameType, `S${gameType.slice(0, 5).toUpperCase()}`);
    const frame = finalReplayFrame(replay);
    expect(frame).toEqual(snapshots.at(-1));
    expect(frame.result).not.toBeNull();
    const known = new Set([...STATS_RECORDS[gameType].map((record) => record.id), ...(LOG_METRICS[gameType] ?? []),
      'overtricks', 'firstOut', 'fouls', 'shots', 'diceLost', 'jokerLosses', 'shotsFired', 'shotsHit']);
    for (const seat of matchSeats(match.result)) {
      const logged = matchFacts(match.result, seat, frame);
      const unlogged = matchFacts(match.result, seat, null);
      for (const values of [logged.counts, logged.sums, logged.values]) {
        for (const [key, value] of Object.entries(values)) {
          expect(known.has(key), key).toBe(true);
          expect(Number.isSafeInteger(value)).toBe(true);
        }
      }
      // Without a log only result records remain, and they agree with the logged facts.
      const logIds = new Set([...STATS_RECORDS[gameType].filter((record) => record.source === 'log').map((record) => record.id),
        ...(LOG_METRICS[gameType] ?? [])]);
      for (const key of Object.keys(unlogged.counts)) expect(logIds.has(key)).toBe(false);
      const resultOnly = (values: Readonly<Record<string, number>>): Record<string, number> =>
        Object.fromEntries(Object.entries(values).filter(([key]) => !logIds.has(key)));
      expect(resultOnly(logged.counts)).toEqual(unlogged.counts);
      expect(resultOnly(logged.values)).toEqual(unlogged.values);
    }
  });

  it('counts Big Two combinations from the public log only for the playing seat', () => {
    const { replay, match } = recordMatch('bigtwo', 'SBIG2');
    const frame = finalReplayFrame(replay);
    if (frame.gameType !== 'bigtwo') throw new Error('Expected Big Two');
    for (const seat of ['N', 'E', 'S', 'W'] as const) {
      const plays = frame.log.filter((entry) => entry.type === 'play' && entry.seat === seat);
      const facts = matchFacts(match.result, seat, frame);
      expect(facts.counts.fullHouses ?? 0).toBe(plays.filter((entry) => entry.type === 'play' && entry.comboType === 'fullHouse').length);
    }
  });
});

describe('result records', () => {
  it('Big Two: dragon and collected penalties for the winner, caught twos for the others', () => {
    const result: BigTwoMatchResult = { gameType: 'bigtwo', winnerSeat: 'N', dragon: true, cardsLeft: { N: 0, E: 3, S: 5, W: 1 },
      twosLeft: { N: 0, E: 1, S: 0, W: 0 }, scores: { N: 0, E: 6, S: 5, W: 1 } };
    expect(matchFacts(result, 'N', null)).toEqual({ counts: { dragons: 1 }, sums: {}, values: { topCollect: 12 } });
    expect(matchFacts(result, 'E', null).counts).toEqual({ caughtTwos: 1 });
    expect(matchFacts(result, 'S', null).counts).toEqual({});
  });

  it('Bridge: made contracts count for both declaring partners only', () => {
    const result: MatchResult = { gameType: 'bridge', contract: { level: 6, suit: 'nt', declarer: 'E' }, declarerTeamTricks: 13,
      defenderTeamTricks: 0, requiredTricks: 12, declarerTeamWins: true };
    for (const seat of ['E', 'W'] as const) {
      expect(matchFacts(result, seat, null)).toEqual({ counts: { slams: 1, ntMade: 1 }, sums: { overtricks: 1 },
        values: { topContract: encodeContract(6, 'nt') } });
    }
    expect(matchFacts(result, 'N', null)).toEqual({ counts: {}, sums: {}, values: {} });
    expect(decodeContract(encodeContract(6, 'nt'))).toEqual({ level: 6, suit: 'nt' });
    expect(encodeContract(7, 'clubs')).toBeGreaterThan(encodeContract(6, 'nt'));
  });

  it('Napoleon: solo wins and contracts for the Napoleon; all sixteen for the declaring side', () => {
    const result: MatchResult = { gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'],
      contract: { level: 14, suit: 'hearts', napoleon: 'N' }, secretaryCard: card('spades', 14), secretarySeat: 'S',
      points: { N: 10, E: 0, S: 6, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, discards: [], discardPoints: 0, napoleonPoints: 16,
      defenderPoints: 0, napoleonWins: true, winners: ['N', 'S'] };
    expect(matchFacts(result, 'N', null).counts).toEqual({ allSixteen: 1 });
    expect(matchFacts(result, 'N', null).values).toEqual({ topContract: encodeContract(14, 'hearts') });
    expect(matchFacts(result, 'S', null).counts).toEqual({ allSixteen: 1 });
    expect(matchFacts({ ...result, secretarySeat: null }, 'N', null).counts).toEqual({ allSixteen: 1, soloWins: 1 });
    expect(matchFacts(result, 'E', null).counts).toEqual({});
  });
});

describe('log records', () => {
  it('Go Fish: hands with the most books and the match total from the result, cards taken and lucky fishes from the log', () => {
    const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
    const result: MatchResult = { gameType: 'gofish', seats: ['N', 'E', 'S'], hands: 3, scores: { ...zero, N: 15, E: 14, S: 10 },
      handBooks: [{ ...zero, N: 5, E: 5, S: 3 }, { ...zero, N: 4, E: 6, S: 3 }, { ...zero, N: 6, E: 3, S: 4 }], winners: ['N'] };
    const ask = (seat: Seat, given: number, fished: 'lucky' | 'miss' | null) => ({ type: 'ask' as const, seat, target: 'E' as const,
      rank: 7 as const, given, fished, timestamp: 1 });
    const frame = { gameType: 'gofish', log: [ask('N', 2, null), ask('N', 0, 'lucky'), ask('S', 0, 'miss'), ask('N', 1, null)] } as unknown as ReplaySnapshot;
    expect(matchFacts(result, 'N', null)).toMatchObject({ counts: { handsWon: 2 }, values: { topBooks: 15 } });
    expect(matchFacts(result, 'N', frame).counts).toEqual({ handsWon: 2, cardsTaken: 3, luckyFishes: 1 });
    expect(matchFacts(result, 'E', null).counts).toEqual({ handsWon: 2 });
    expect(matchFacts(result, 'S', frame)).toMatchObject({ values: { topBooks: 10 } });
    expect(matchFacts(result, 'S', frame).counts).toEqual({});
  });

  it('Crazy Eights: hands won and the lowest total from the result, 8s, wild finishes and penalties from the log', () => {
    const zero = { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 };
    const result: MatchResult = { gameType: 'crazyeights', seats: ['N', 'E', 'S'], hands: 3, handWinners: ['N', 'E', 'N'],
      scores: { ...zero, N: 4, E: 17, S: 61 }, winners: ['N'] };
    const entry = (seat: Seat, played: Card, effect: 'draw' | null = null, drawn = 0) => ({ type: 'play' as const, seat,
      card: played, suit: played.rank === 8 ? 'hearts' as const : null, effect, target: effect ? 'E' as const : null,
      drawn, timestamp: 1 });
    const frame = { gameType: 'crazyeights', log: [
      entry('N', card('clubs', 8)), entry('S', card('hearts', 2), 'draw', 2),
      { type: 'handEnd', hand: 1, winner: 'N', points: zero, timestamp: 1 },
      entry('N', card('spades', 8)),
      { type: 'handEnd', hand: 2, winner: 'N', points: zero, timestamp: 2 },
    ] } as unknown as ReplaySnapshot;
    expect(matchFacts(result, 'N', null)).toMatchObject({ counts: { handsWon: 2 }, values: { lowScore: 4 } });
    expect(matchFacts(result, 'N', frame).counts).toEqual({ handsWon: 2, eights: 2, wildFinishes: 1 });
    expect(matchFacts(result, 'S', frame)).toMatchObject({ counts: { penaltiesDealt: 2 }, values: { lowScore: 61 } });
    expect(matchFacts(result, 'E', null).counts).toEqual({ handsWon: 1 });
  });

  it('99: spade aces, kings, and every seat knocked out right after the seat played', () => {
    const result: NinetyNineMatchResult = { gameType: 'ninetynine', eliminationOrder: ['E', 'S', 'W'], finalTotal: 99, winnerSeat: 'N' };
    const play = (seat: Seat, played: Card) => ({ type: 'play' as const, seat, card: played, choice: null, target: null,
      total: 0, timestamp: 1 });
    const out = (seat: Seat) => ({ type: 'eliminated' as const, seat, timestamp: 1 });
    const frame = { gameType: 'ninetynine',
      log: [play('N', card('spades', 14)), play('E', card('clubs', 13)), out('S'), play('N', card('hearts', 13)), out('E'), out('W')] };
    expect(matchFacts(result, 'N', frame as unknown as ReplaySnapshot).counts).toEqual({ spadeAces: 1, kings: 1, knockouts: 2 });
    expect(matchFacts(result, 'E', frame as unknown as ReplaySnapshot).counts).toEqual({ firstOut: 1, kings: 1, knockouts: 1 });
  });

  it("Hold'em: only revealed hands count, with pots, all-in wins and knockouts of hands the seat won", () => {
    const board = [card('hearts', 13), card('clubs', 13), card('spades', 7), card('diamonds', 2), card('hearts', 4)];
    const frame = { gameType: 'holdem', log: [
      { type: 'hand', hand: 1, button: 'N', smallBlind: 10, bigBlind: 20, blinds: {}, timestamp: 1 },
      { type: 'action', seat: 'N', action: 'raise', to: 500, allIn: true, timestamp: 1 },
      { type: 'street', street: 'flop', cards: board.slice(0, 3), timestamp: 1 },
      { type: 'street', street: 'turn', cards: board.slice(3, 4), timestamp: 1 },
      { type: 'street', street: 'river', cards: board.slice(4), timestamp: 1 },
      { type: 'showdown', cards: { N: [card('diamonds', 13), card('clubs', 7)], E: [card('spades', 2), card('clubs', 3)], S: [], W: [] },
        timestamp: 1 },
      { type: 'award', pots: [{ amount: 1001, eligible: ['N', 'E'], winners: ['N'] }], chips: {}, eliminated: ['E'], timestamp: 1 },
      { type: 'hand', hand: 2, button: 'E', smallBlind: 10, bigBlind: 20, blinds: {}, timestamp: 1 },
      { type: 'award', pots: [{ amount: 30, eligible: ['N'], winners: ['N'] }], chips: {}, eliminated: [], timestamp: 1 },
    ] } as unknown as ReplaySnapshot;
    const facts = holdemFacts('N', frame);
    expect(facts.counts).toEqual({ showdowns: 1, showdownWins: 1, allInWins: 1, knockouts: 1 });
    expect(facts.values.biggestPot).toBe(1001);
    expect(decodePokerHand(facts.values.bestShowdown)).toEqual({ category: 'fullHouse', ranks: [13, 7] });
    expect(holdemFacts('E', frame).counts).toEqual({ showdowns: 1 });
    expect(encodePokerHand({ category: 'straightFlush', ranks: [5] }))
      .toBeGreaterThan(encodePokerHand({ category: 'fourOfAKind', ranks: [14, 13] }));
  });
});

describe('accumulated counters', () => {
  const win: MatchResult = { gameType: 'redpoints', points: { N: 120, E: 40, S: 30, W: 18 }, winners: ['N'] };
  const tie: MatchResult = { gameType: 'redpoints', points: { N: 70, E: 70, S: 40, W: 28 }, winners: ['N', 'E'] };
  const loss: MatchResult = { gameType: 'redpoints', points: { N: 10, E: 70, S: 100, W: 28 }, winners: ['S'] };

  it('counts ranks, ties as wins, streaks, records and remembered matches', () => {
    let stats: GameStats | null = null;
    stats = countGameMatch(stats, counted(win, 'N', { matchId: 'a', at: 1 }));
    stats = countGameMatch(stats, counted(tie, 'N', { matchId: 'b', at: 2 }));
    expect(stats).toMatchObject({ matches: 2, wins: 2, ties: 1, ranks: [2, 0, 0, 0], streak: { current: 2, best: 2 },
      tables: { 4: 2 }, counts: { hundreds: 1, topTwo: 2 }, sums: { rank: 2, score: 190 },
      best: { topPoints: { value: 120, matchId: 'a', at: 1 } }, latest: { hundreds: { value: 1, matchId: 'a', at: 1 } } });
    stats = countGameMatch(stats, counted(loss, 'N', { matchId: 'c', at: 3 }));
    expect(stats).toMatchObject({ matches: 3, wins: 2, ranks: [2, 0, 0, 1], streak: { current: 0, best: 2 },
      sums: { rank: 6, score: 200, lossScore: 10 }, lastAt: 3, version: STATS_VERSION, versionSince: {} });
  });

  it('marks where log records start when earlier matches had no log', () => {
    let stats = countGameMatch(null, counted(win, 'N', { at: 1 }));
    stats = countGameMatch(stats, counted(win, 'N', { at: 2, logged: true }));
    stats = countGameMatch(stats, counted(win, 'N', { at: 3, logged: true }));
    expect(stats).toMatchObject({ logged: 2, logSince: 2 });
    expect(countGameMatch(null, counted(win, 'N', { logged: true }))).toMatchObject({ logged: 1, logSince: null });
  });

  it('records the version a record set started with when counters move to a newer definitions version', () => {
    const old = { ...countGameMatch(null, counted(win, 'N', { at: 1 })), version: STATS_VERSION - 1, versionSince: {} };
    if (STATS_VERSION === 1) {
      expect(countGameMatch(old, counted(win, 'N', { at: 5 })).versionSince).toEqual({ 1: 5 });
    }
    expect(countGameMatch(old, counted(win, 'N', { at: 5 })).version).toBe(STATS_VERSION);
  });

  it('keeps the latest ten results and the cross-game streak per account', () => {
    let stats = countAccountMatch(null, counted(win, 'N', { since: 7 }));
    for (let index = 0; index < 11; index++) stats = countAccountMatch(stats, counted(index === 5 ? loss : tie, 'N', { at: index }));
    expect(stats.since).toBe(7);
    expect(stats.recent).toHaveLength(10);
    expect(stats.recent.at(-1)).toMatchObject({ outcome: 'tie', at: 10 });
    expect(stats.streak).toEqual({ current: 5, best: 6 });
  });
});
