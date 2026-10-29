import { describe, expect, it } from 'vitest';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import type { GameSeat, MatchResult } from '@shared/types';
import { gameSeatValues } from '../helpers/game-seat-values';

const stand = (result: MatchResult, seat: GameSeat) => matchStanding(result, seat);
const ranks = (result: MatchResult, seats: readonly GameSeat[]) => seats.map((seat) => stand(result, seat)?.rank);
const wins = (result: MatchResult, seats: readonly GameSeat[]) => seats.map((seat) => stand(result, seat)?.won);
const NESW: readonly GameSeat[] = ['N', 'E', 'S', 'W'];

describe('ranking games', () => {
  it('ranks Big Two by penalty with the emptied hand first', () => {
    const result: MatchResult = { gameType: 'bigtwo', winnerSeat: 'S', dragon: false,
      cardsLeft: { N: 3, E: 3, S: 0, W: 9 }, twosLeft: { N: 0, E: 0, S: 0, W: 1 }, scores: { N: 3, E: 3, S: 0, W: 18 } };
    expect(ranks(result, NESW)).toEqual([2, 2, 1, 4]);
    expect(stand(result, 'S')).toMatchObject({ won: true, tied: false, score: 0, players: 4, side: null, role: null });
    expect(stand(result, 'N')).toMatchObject({ won: false, tied: true, score: 3 });
  });

  it('counts every seat tied for the most points as a winning tie and ranks the rest after them', () => {
    const result: MatchResult = { gameType: 'redpoints', points: { N: 80, E: 80, S: 44, W: 24 }, winners: ['N', 'E'] };
    expect(ranks(result, NESW)).toEqual([1, 1, 3, 4]);
    expect(wins(result, NESW)).toEqual([true, true, false, false]);
    expect(stand(result, 'N')).toMatchObject({ tied: true, score: 80 });
    expect(stand(result, 'S')).toMatchObject({ tied: false });
  });

  it('ranks Sevens by the lowest penalty and Chinese Poker by the highest score', () => {
    const sevens: MatchResult = { gameType: 'sevens', penalties: { N: 0, E: 12, S: 12, W: 30 },
      covered: { N: [], E: [], S: [], W: [] }, winners: ['N'] };
    expect(ranks(sevens, NESW)).toEqual([1, 2, 2, 4]);
    const poker: MatchResult = gameSeatValues({ gameType: 'chinesepoker', arrangements: {}, fouls: [], matchups: [],
      homeRun: null, scores: { N: -3, E: 5, S: 5, W: -7 }, winners: ['E', 'S'] }) as unknown as MatchResult;
    expect(ranks(poker, NESW)).toEqual([3, 1, 1, 4]);
  });

  it('uses the elimination order for Ninety-Nine, with the last survivors tied in a two-deck game', () => {
    const lastSurvivor: MatchResult = { gameType: 'ninetynine', winnerSeat: 'W', eliminationOrder: ['N', 'E', 'S'], finalTotal: 99 };
    expect(ranks(lastSurvivor, NESW)).toEqual([4, 3, 2, 1]);
    const stockOut: MatchResult = { gameType: 'ninetynine', seats: ['N', 'E', 'S'], winners: ['E', 'S'],
      eliminationOrder: ['N'], finalTotal: 61 };
    expect(ranks(stockOut, ['N', 'E', 'S'])).toEqual([3, 1, 1]);
    expect(wins(stockOut, ['N', 'E', 'S'])).toEqual([false, true, true]);
    expect(stand(stockOut, 'E')).toMatchObject({ tied: true, players: 3 });
  });

  it('ranks Go Fish by the most books, with equal totals sharing the win', () => {
    const scores = { N: 20, E: 20, S: 3, W: 32, P5: 0, P6: 0, P7: 0, P8: 0 };
    const handBooks = [{ ...scores, N: 7, E: 7, S: 1, W: 5 }, { ...scores, N: 6, E: 6, S: 1, W: 6 }, { ...scores, N: 7, E: 7, S: 1, W: 21 }];
    const result: MatchResult = { gameType: 'gofish', seats: ['N', 'E', 'S', 'W'], hands: 3, handBooks, scores, winners: ['W'] };
    expect(ranks(result, NESW)).toEqual([2, 2, 4, 1]);
    expect(wins(result, NESW)).toEqual([false, false, false, true]);
    const tied: MatchResult = { ...result, scores: { ...scores, W: 20 }, winners: ['N', 'E', 'W'] };
    expect(ranks(tied, NESW)).toEqual([1, 1, 4, 1]);
    expect(stand(tied, 'E')).toMatchObject({ tied: true, won: true, score: 20, players: 4 });
  });

  it('ranks Crazy Eights by the lowest total, with equal totals sharing the win', () => {
    const scores = { N: 12, E: 12, S: 40, W: 3, P5: 0, P6: 0, P7: 0, P8: 0 };
    const result: MatchResult = { gameType: 'crazyeights', seats: ['N', 'E', 'S', 'W'], hands: 3,
      handWinners: ['W', 'W', 'N'], scores, winners: ['W'] };
    expect(ranks(result, NESW)).toEqual([2, 2, 4, 1]);
    expect(wins(result, NESW)).toEqual([false, false, false, true]);
    const tied: MatchResult = { ...result, scores: { ...scores, W: 12 }, winners: ['N', 'E', 'W'] };
    expect(ranks(tied, NESW)).toEqual([1, 1, 4, 1]);
    expect(stand(tied, 'E')).toMatchObject({ tied: true, won: true, score: 12, players: 4 });
  });

  it('ranks Liar\'s Deck eliminated seats in reverse order of elimination', () => {
    const result: MatchResult = { gameType: 'liarsdeck', winnerSeat: 'E', eliminationOrder: ['S', 'W', 'N'],
      shots: { N: 3, E: 1, S: 1, W: 2 }, rounds: 7 };
    expect(ranks(result, NESW)).toEqual([2, 1, 4, 3]);
  });

  it('reports chips against the starting stack and shares first place when stacks are equal', () => {
    const blackjack: MatchResult = gameSeatValues({ gameType: 'blackjack', seats: ['N', 'E', 'P8'], hands: 8,
      chips: { N: 1500, E: 1500, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, winners: ['N', 'E'] }) as unknown as MatchResult;
    expect(stand(blackjack, 'N')).toMatchObject({ rank: 1, tied: true, won: true, score: 500, players: 3 });
    expect(stand(blackjack, 'P8')).toMatchObject({ rank: 3, won: false, score: -1000 });
  });

  it('ranks Hold\'em survivors by chips and busted seats by when they went out', () => {
    const result: MatchResult = gameSeatValues({ gameType: 'holdem', hands: 20,
      chips: { N: 2200, E: 1800, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, winners: ['N'], eliminationOrder: ['S', 'W'] }) as unknown as MatchResult;
    expect(ranks(result, NESW)).toEqual([1, 2, 4, 3]);
    expect(stand(result, 'E')).toMatchObject({ score: 800, won: false });
    const headsUp: MatchResult = gameSeatValues({ gameType: 'holdem', seats: ['E', 'W'], hands: 9,
      chips: { N: 0, E: 0, S: 0, W: 2000, P5: 0, P6: 0, P7: 0, P8: 0 }, winners: ['W'], eliminationOrder: ['E'] }) as unknown as MatchResult;
    expect(ranks(headsUp, ['E', 'W'])).toEqual([2, 1]);
  });

  it('returns null for a seat that did not take part', () => {
    const headsUp: MatchResult = gameSeatValues({ gameType: 'holdem', seats: ['E', 'W'], hands: 9,
      chips: { N: 0, E: 0, S: 0, W: 2000, P5: 0, P6: 0, P7: 0, P8: 0 }, winners: ['W'], eliminationOrder: ['E'] }) as unknown as MatchResult;
    expect(stand(headsUp, 'N')).toBeNull();
    expect(matchSeats(headsUp)).toEqual(['E', 'W']);
  });
});

describe('team games', () => {
  const bridge = (declarer: 'N' | 'E' | 'S' | 'W', declarerTeamWins: boolean): MatchResult => ({
    gameType: 'bridge', contract: { level: 4, suit: 'spades', declarer }, declarerTeamTricks: 10, defenderTeamTricks: 3,
    requiredTricks: 10, declarerTeamWins });

  it('credits both partners of the winning side and assigns declarer, partner and defender roles', () => {
    const made = bridge('E', true);
    expect(wins(made, NESW)).toEqual([false, true, false, true]);
    expect(NESW.map((seat) => stand(made, seat)?.role)).toEqual(['defender', 'declarer', 'defender', 'partner']);
    expect(NESW.map((seat) => stand(made, seat)?.side)).toEqual(['defender', 'declarer', 'defender', 'declarer']);
    const down = bridge('N', false);
    expect(wins(down, NESW)).toEqual([false, true, false, true]);
    expect(stand(down, 'N')).toMatchObject({ rank: null, tied: false, role: 'declarer', side: 'declarer', won: false });
  });
});

describe('Napoleon roles', () => {
  const napoleon = (secretarySeat: GameSeat | null, napoleonWins: boolean): MatchResult => ({
    gameType: 'napoleon', seats: ['N', 'E', 'S', 'W', 'P5'], contract: { level: 13, suit: 'hearts', napoleon: 'S' },
    secretarySeat, points: { N: 0, E: 0, S: 0, W: 0, P5: 0, P6: 0, P7: 0, P8: 0 }, discards: [], discardPoints: 0,
    napoleonPoints: napoleonWins ? 14 : 9, defenderPoints: napoleonWins ? 6 : 11, napoleonWins,
    winners: napoleonWins ? (secretarySeat ? ['S', secretarySeat] : ['S']) : ['N', 'E', 'W', 'P5'].filter((seat) => seat !== secretarySeat),
  } as unknown as MatchResult);
  const seats: readonly GameSeat[] = ['N', 'E', 'S', 'W', 'P5'];

  it('splits the Napoleon, the secretary and the defenders, and credits the secretary with the side win', () => {
    const won = napoleon('E', true);
    expect(seats.map((seat) => stand(won, seat)?.role)).toEqual(['defender', 'secretary', 'napoleon', 'defender', 'defender']);
    expect(wins(won, seats)).toEqual([false, true, true, false, false]);
    expect(stand(won, 'E')).toMatchObject({ side: 'declarer', rank: null, tied: false, players: 5 });
    const lost = napoleon('E', false);
    expect(wins(lost, seats)).toEqual([true, false, false, true, true]);
    expect(stand(lost, 'W')).toMatchObject({ role: 'defender', side: 'defender', won: true });
  });

  it('plays alone when the Napoleon held the secretary card', () => {
    const solo = napoleon(null, true);
    expect(seats.map((seat) => stand(solo, seat)?.role)).toEqual(['defender', 'defender', 'napoleon', 'defender', 'defender']);
    expect(wins(solo, seats)).toEqual([false, false, true, false, false]);
  });
});
