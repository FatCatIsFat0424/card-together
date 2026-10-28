import { describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import { GAME_SEAT_ORDER } from '@shared/constants';
import { studAward, studReplay } from '@shared/rules/stud';
import { heEliminations } from '@shared/rules/holdem';
import { gameDefinition } from '@shared/games/registry';
import { studFacts } from '@shared/stats/stud';
import { decodePokerHand } from '@shared/stats/holdem';
import type { Card, GameSeat, ReplaySnapshot, Seat, StudLogEntry, StudMatchResult, StudVisibleState } from '@shared/types';
import { seatState, streetActions } from '../../../client/src/games/holdem/holdem-view';
import { studCategory, studChipsAdded, studShownAward, studView } from '../../../client/src/games/stud/stud-view';
import { deriveRoundHistory } from '../../../client/src/games/round-history';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const SEATS: readonly Seat[] = ['N', 'E', 'S'];
const zero = (): Record<GameSeat, number> => Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, 0])) as Record<GameSeat, number>;
const noCards = (): Record<GameSeat, Card[]> => Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, []])) as unknown as Record<GameSeat, Card[]>;

function upCards(cards: Partial<Record<Seat, Card>>): Record<GameSeat, Card[]> {
  const result = noCards();
  for (const [seat, card] of Object.entries(cards)) result[seat as GameSeat] = [card];
  return result;
}

/** Hand 1: N shows A, E bets, S folds, N calls; later cards are checked down and N wins with aces up. */
function buildLog(): StudLogEntry[] {
  const log: StudLogEntry[] = [
    { type: 'hand', hand: 1, button: 'S', ante: 10, minBet: 20, antes: { ...zero(), N: 10, E: 10, S: 10 }, timestamp: 1 },
    { type: 'street', street: 2, cards: upCards({ N: c(14, 'hearts'), E: c(9, 'clubs'), S: c(5, 'clubs') }), timestamp: 2 },
    { type: 'action', seat: 'N', action: 'bet', to: 40, allIn: false, timestamp: 3 },
    { type: 'action', seat: 'E', action: 'call', to: 40, allIn: false, timestamp: 4 },
    { type: 'action', seat: 'S', action: 'fold', to: 0, allIn: false, timestamp: 5 },
    { type: 'street', street: 3, cards: upCards({ N: c(14, 'clubs'), E: c(9, 'hearts') }), timestamp: 6 },
    { type: 'action', seat: 'N', action: 'check', to: 0, allIn: false, timestamp: 7 },
    { type: 'action', seat: 'E', action: 'check', to: 0, allIn: false, timestamp: 8 },
    { type: 'street', street: 4, cards: upCards({ N: c(2, 'clubs'), E: c(3, 'hearts') }), timestamp: 9 },
    { type: 'action', seat: 'N', action: 'check', to: 0, allIn: false, timestamp: 10 },
    { type: 'action', seat: 'E', action: 'check', to: 0, allIn: false, timestamp: 11 },
    { type: 'street', street: 5, cards: upCards({ N: c(7, 'diamonds'), E: c(13, 'hearts') }), timestamp: 12 },
    { type: 'action', seat: 'N', action: 'check', to: 0, allIn: false, timestamp: 13 },
    { type: 'action', seat: 'E', action: 'check', to: 0, allIn: false, timestamp: 14 },
    { type: 'showdown', cards: { ...noCards(), N: [c(4, 'spades')], E: [c(8, 'spades')] }, timestamp: 15 },
  ];
  const table = studReplay(log, SEATS);
  const { pots, payouts } = studAward(table);
  const chips = Object.fromEntries(GAME_SEAT_ORDER.map((seat) => [seat, table.chips[seat] + payouts[seat]])) as Record<GameSeat, number>;
  log.push({ type: 'award', pots, chips, eliminated: heEliminations(table, chips), timestamp: 16 });
  return log;
}

function visible(log: StudLogEntry[]): StudVisibleState {
  const table = studReplay(log, SEATS);
  return {
    gameType: 'stud', phase: 'playing', mySeat: 'N', seats: SEATS, myHand: [c(4, 'spades')], hand: table.hand,
    button: table.button, ante: table.ante, minBet: table.minBet, chips: table.chips, streetBets: table.streetBets,
    totalBets: table.totalBets, dealt: table.dealt, folded: table.folded, street: table.street, up: table.up,
    currentBet: table.currentBet, minRaise: table.minRaise, acted: table.acted, revealed: table.revealed,
    eliminated: table.eliminated, currentTurnSeat: 'N', log, result: null,
  };
}

describe('stud table view', () => {
  it('rebuilds the table, up cards and award up to the frame on screen', () => {
    const log = buildLog();
    const game = visible(log);
    const frames = getPresentationFrames({ ...game, presentation: { id: 'a', startedAt: 0, logStart: 0 } } as StudVisibleState);
    expect(frames.length).toBeGreaterThan(0);
    const early = studView(game, frames[1]);
    expect(early.logEnd).toBe(2);
    expect(early.up.N).toEqual([c(14, 'hearts')]);
    expect(early.award).toBeNull();
    const live = studView(game, null);
    expect(live.logEnd).toBe(log.length);
    expect(live.award?.payouts).toMatchObject({ N: 110 });
  });

  it('knows seat states, street actions and chips added by a call', () => {
    const log = buildLog();
    const mid = studReplay(log.slice(0, 5), SEATS);
    expect(seatState(mid, 'S')).toBe('folded');
    expect(seatState(mid, 'N')).toBe('active');
    expect(streetActions(log, 5)).toMatchObject({ N: 'bet', E: 'call', S: 'fold' });
    expect(studChipsAdded(log, 3)).toBe(40);
    expect(studShownAward(log, SEATS, 5)).toBeNull();
    expect(studShownAward(log, SEATS, log.length)?.payouts.N).toBeGreaterThan(0);
  });

  it('names the five-card category only once all four up cards are out', () => {
    expect(studCategory([c(4, 'spades')], [c(14, 'hearts'), c(14, 'clubs')])).toBeNull();
    expect(studCategory([c(4, 'spades')], [c(14, 'hearts'), c(14, 'clubs'), c(2, 'clubs'), c(7, 'diamonds')])).toBe('pair');
  });
});

describe('stud history and statistics', () => {
  it('builds one round per hand with antes, up cards, betting, showdown, and winnings', () => {
    const log = buildLog();
    const rounds = deriveRoundHistory({ gameType: 'stud', phase: 'playing', seats: SEATS, log });
    expect(rounds).toHaveLength(1);
    const kinds = rounds[0].actions.map((action) => action.kind);
    expect(kinds.slice(0, 3)).toEqual(['ante', 'ante', 'ante']);
    expect(rounds[0].actions[0].stakes).toEqual({ ante: 10, minBet: 20 });
    expect(kinds).toContain('showdown');
    expect(kinds.at(-1)).toBe('award');
    expect(rounds[0].complete).toBe(true);
    expect(rounds[0].actions.find((action) => action.kind === 'showdown' && action.seat === 'N')).toMatchObject({ category: 'pair' });
  });

  it('counts only revealed showdowns, pots and the best revealed hand', () => {
    const frame = { gameType: 'stud', log: buildLog() } as unknown as ReplaySnapshot;
    const facts = studFacts('N', frame);
    expect(facts.counts).toEqual({ showdowns: 1, showdownWins: 1 });
    expect(facts.values.biggestPot).toBe(110);
    expect(decodePokerHand(facts.values.bestShowdown).category).toBe('pair');
    expect(studFacts('S', frame).counts).toEqual({});
  });

  it('ranks busted seats by elimination order and survivors by chips', () => {
    const definition = gameDefinition('stud');
    const result: StudMatchResult = { gameType: 'stud', seats: ['N', 'E', 'S'], hands: 12,
      chips: { ...zero(), N: 2100, E: 900, S: 0 }, winners: ['N'], eliminationOrder: ['S'] };
    const stand = (seat: GameSeat) => definition.result.standing(result, seat, ['N', 'E', 'S']);
    expect([stand('N').rank, stand('E').rank, stand('S').rank]).toEqual([1, 2, 3]);
    expect(stand('N')).toMatchObject({ won: true, score: 1100 });
  });
});
