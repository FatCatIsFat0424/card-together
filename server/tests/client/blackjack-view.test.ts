import { describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import { bjReplay } from '@shared/rules/blackjack';
import type { BlackjackLogEntry, BlackjackVisibleState, Card, Seat } from '@shared/types';
import {
  autoBetSeats, betChips, blackjackActions, blackjackDealerActions, blackjackHandNumber, blackjackNeedsBet, blackjackSeatOut, blackjackView,
  clampBet, handNet, rankBlackjack, recentBlackjackMoves, replayBlackjack, signedChips, stepBet,
} from '../../../client/src/games/blackjack/blackjack-view';
import { deriveRoundHistory } from '../../../client/src/games/round-history';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const seats = <T>(value: T): Record<Seat, T> => ({ N: value, E: value, S: value, W: value });
const ALL: readonly Seat[] = ['N', 'E', 'S', 'W'];

/**
 * Hand 1: N hits to 21, E has a natural, S splits eights and doubles the first hand, W doubles.
 * The dealer reveals and draws to 20, then hand 2 is dealt.
 */
const log: BlackjackLogEntry[] = [
  { type: 'bet', seat: 'N', auto: false, timestamp: 1 },
  { type: 'bet', seat: 'E', auto: false, timestamp: 2 },
  { type: 'bet', seat: 'S', auto: true, timestamp: 3 },
  { type: 'bet', seat: 'W', auto: false, timestamp: 4 },
  {
    type: 'deal', hand: 1, bets: { N: 50, E: 20, S: 10, W: 20 },
    cards: {
      N: [c(10, 'spades'), c(6, 'hearts')], E: [c(14, 'spades'), c(13, 'hearts')],
      S: [c(8, 'clubs'), c(8, 'diamonds')], W: [c(5, 'spades'), c(6, 'diamonds')],
    },
    upCard: c(9, 'hearts'), timestamp: 5,
  },
  { type: 'hit', seat: 'N', handIndex: 0, card: c(5, 'clubs'), timestamp: 6 },
  { type: 'split', seat: 'S', handIndex: 0, cards: [c(3, 'spades'), c(10, 'clubs')], timestamp: 7 },
  { type: 'double', seat: 'S', handIndex: 0, card: c(10, 'diamonds'), timestamp: 8 },
  { type: 'stand', seat: 'S', handIndex: 1, timestamp: 9 },
  { type: 'double', seat: 'W', handIndex: 0, card: c(9, 'spades'), timestamp: 10 },
  { type: 'reveal', card: c(7, 'clubs'), timestamp: 11 },
  { type: 'dealerHit', card: c(4, 'diamonds'), timestamp: 12 },
  {
    type: 'settle', hand: 1,
    outcomes: { N: ['win'], E: ['blackjack'], S: ['win', 'lose'], W: ['push'] },
    net: { N: 50, E: 30, S: 10, W: 0 }, chips: { N: 1050, E: 1030, S: 1010, W: 1000 }, timestamp: 13,
  },
  { type: 'bet', seat: 'N', auto: false, timestamp: 14 },
  {
    type: 'deal', hand: 2, bets: seats(10),
    cards: {
      N: [c(2, 'spades'), c(3, 'hearts')], E: [c(4, 'spades'), c(5, 'hearts')],
      S: [c(6, 'clubs'), c(7, 'diamonds')], W: [c(9, 'clubs'), c(9, 'diamonds')],
    },
    upCard: c(14, 'hearts'), timestamp: 15,
  },
];

function game(overrides: Partial<BlackjackVisibleState> = {}): BlackjackVisibleState {
  const table = bjReplay(log, ALL);
  return {
    gameType: 'blackjack', phase: 'playing', mySeat: 'S', seats: ALL, options: { playerDealer: false },
    dealerSeat: null, totalHands: 8, hand: table.hand, chips: table.chips, myBet: null,
    betPlaced: seats(false), betDeadline: null, hands: table.hands, dealer: table.dealer, holeHidden: true,
    currentTurnSeat: 'N', activeHand: 0, log,
    presentation: { id: 'p', startedAt: 0, logStart: 5, timingVersion: 2 }, result: null, ...overrides,
  };
}

describe('Blackjack table view', () => {
  it('should keep the hole card face down and outcomes hidden until their frames', () => {
    const state = game();
    const frames = getPresentationFrames(state);
    expect(frames.map((frame) => frame.kind)).toEqual(
      ['hit', 'split', 'double', 'stand', 'double', 'dealerReveal', 'dealerHit', 'settle', 'deal']);
    const [hit, split, , , , reveal, , settle, deal] = frames;

    const afterHit = blackjackView(state, hit);
    expect(afterHit).toMatchObject({ hand: 1, holeHidden: true, settlement: null, logEnd: 6 });
    expect(afterHit.dealer).toEqual([c(9, 'hearts')]);
    expect(afterHit.hands.N[0].cards).toHaveLength(3);
    // N reached 21 and E holds a natural, so S acts next.
    expect(afterHit.turn).toEqual({ seat: 'S', handIndex: 0 });

    expect(blackjackView(state, split).hands.S.map((hand) => hand.cards.length)).toEqual([2, 2]);

    const revealed = blackjackView(state, reveal);
    expect(revealed.holeHidden).toBe(false);
    expect(revealed.dealer).toEqual([c(9, 'hearts'), c(7, 'clubs')]);
    expect(revealed.settlement).toBeNull();
    expect(revealed.turn).toBeNull();

    // The settle frame shows hand 1's results; hand 2 has not been dealt yet.
    const settled = blackjackView(state, settle);
    expect(settled).toMatchObject({ hand: 1, chips: { N: 1050, E: 1030, S: 1010, W: 1000 } });
    expect(settled.settlement?.outcomes.S).toEqual(['win', 'lose']);
    expect(settled.hands.W[0]).toMatchObject({ bet: 40, doubled: true });

    const dealt = blackjackView(state, deal);
    expect(dealt).toMatchObject({ hand: 2, holeHidden: true, settlement: null, logEnd: log.length });
    expect(dealt.dealer).toEqual([c(14, 'hearts')]);
  });

  it('should use the visible state without a frame or on the closing frame', () => {
    const state = game();
    expect(blackjackView(state, null)).toMatchObject({ hand: 2, turn: { seat: 'N', handIndex: 0 }, betting: false });
    const finish = { key: 'p:finish', kind: 'finish' as const, durationMs: 3000, cards: [] };
    expect(blackjackView(state, finish).logEnd).toBe(log.length);
    // While betting, the previous hand stays on the table with its outcomes.
    const betting = game({ phase: 'betting', log: log.slice(0, 13), hand: 1, holeHidden: false, betDeadline: 99 });
    const view = blackjackView(betting, null);
    expect(view).toMatchObject({ betting: true, turn: null });
    expect(view.settlement?.net).toEqual({ N: 50, E: 30, S: 10, W: 0 });
    expect(blackjackHandNumber(view)).toBe(2);
    expect(blackjackHandNumber(blackjackView(state, null))).toBe(2);
  });

  it('should derive the legal buttons for the local seat', () => {
    const table = replayBlackjack(log, ALL, 5);
    const turn = game({ hands: table.hands, chips: table.chips, currentTurnSeat: 'S' });
    expect(blackjackActions(turn, true)).toEqual(['hit', 'stand', 'double', 'split']);
    expect(blackjackActions(turn, false)).toEqual([]);
    expect(blackjackActions(game({ hands: table.hands, currentTurnSeat: 'N' }), true)).toEqual([]);
    expect(blackjackActions({ ...turn, chips: { ...turn.chips, S: 5 } }, true)).toEqual(['hit', 'stand']);
    expect(blackjackActions({ ...turn, phase: 'betting' }, true)).toEqual([]);
  });

  it('should limit bets to the minimum, the step, the maximum, and the chips held', () => {
    expect(betChips(1000).every((chip) => chip.enabled)).toBe(true);
    expect(betChips(75).map((chip) => chip.enabled)).toEqual([true, true, true, false, false]);
    expect(clampBet(73, 1000)).toBe(70);
    expect(clampBet(500, 1000)).toBe(200);
    expect(clampBet(5, 1000)).toBe(10);
    expect(clampBet(200, 75)).toBe(70);
    expect(stepBet(10, -1, 1000)).toBe(10);
    expect(stepBet(190, 1, 1000)).toBe(200);
    expect(stepBet(200, 1, 1000)).toBe(200);
  });

  it('should ask for a bet only while the window is open and the seat can still bet', () => {
    const betting = game({ phase: 'betting', betDeadline: 99 });
    expect(blackjackNeedsBet(betting)).toBe(true);
    expect(blackjackNeedsBet({ ...betting, betDeadline: null })).toBe(false);
    expect(blackjackNeedsBet({ ...betting, myBet: 20 })).toBe(false);
    expect(blackjackNeedsBet({ ...betting, betPlaced: { ...seats(false), S: true } })).toBe(false);
    expect(blackjackNeedsBet({ ...betting, observer: 'spectator' })).toBe(false);
    expect(blackjackNeedsBet({ ...betting, chips: { ...betting.chips, S: 5 } })).toBe(false);
    expect(blackjackNeedsBet(game())).toBe(false);
  });

  it('should mark sitting-out seats, automatic bets, and recent moves', () => {
    const betting = blackjackView(game({ phase: 'betting', chips: { N: 5, E: 100, S: 100, W: 100 } }), null);
    expect(blackjackSeatOut(betting, 'N')).toBe(true);
    expect(blackjackSeatOut(betting, 'E')).toBe(false);
    const playing = blackjackView(game({ hands: { ...bjReplay(log, ALL).hands, W: [] } }), null);
    expect(blackjackSeatOut(playing, 'W')).toBe(true);
    expect(blackjackSeatOut(playing, 'N')).toBe(false);
    expect(autoBetSeats(log, 5)).toEqual(['S']);
    expect(autoBetSeats(log, 4)).toEqual([]);
    expect(autoBetSeats(log, log.length)).toEqual([]);
    expect(recentBlackjackMoves(log, 2).map((entry) => entry.type)).toEqual(['deal', 'bet']);
  });

  it('should give a player dealer its own controls, never ask it to bet, and list its settlement', () => {
    const dealing = game({ mySeat: 'N', dealerSeat: 'N', options: { playerDealer: true }, totalHands: 8 });
    expect(blackjackNeedsBet({ ...dealing, phase: 'betting', betDeadline: 99 })).toBe(false);
    expect(blackjackSeatOut(blackjackView({ ...dealing, phase: 'betting', chips: { ...dealing.chips, N: 0 } }, null), 'N'))
      .toBe(false);
    const turn = { ...dealing, holeHidden: false, currentTurnSeat: 'N' as const, dealer: [c(10, 'hearts'), c(7, 'clubs')] };
    expect(blackjackDealerActions(turn, true)).toEqual(['hit', 'stand']);
    expect(blackjackDealerActions({ ...turn, dealer: [c(10, 'hearts'), c(5, 'clubs')] }, true)).toEqual(['hit']);
    expect(blackjackDealerActions({ ...turn, holeHidden: true }, true)).toEqual([]);
    expect(blackjackDealerActions({ ...turn, mySeat: 'E' }, true)).toEqual([]);
    expect(blackjackDealerActions(turn, false)).toEqual([]);
    expect(blackjackView(turn, null)).toMatchObject({ dealerSeat: 'N', dealerTurn: true });

    const dealt: BlackjackLogEntry[] = [
      { type: 'bet', seat: 'E', auto: false, timestamp: 1 },
      { type: 'deal', hand: 1, bets: { N: 0, E: 20, S: 0, W: 0 }, dealer: 'N',
        cards: { N: [], E: [c(10, 'spades'), c(8, 'hearts')], S: [], W: [] }, upCard: c(10, 'clubs'), timestamp: 2 },
      { type: 'stand', seat: 'E', handIndex: 0, timestamp: 3 },
      { type: 'reveal', card: c(7, 'diamonds'), timestamp: 4 },
      { type: 'dealerStand', timestamp: 5 },
      { type: 'settle', hand: 1, outcomes: { N: [], E: ['win'], S: [], W: [] }, net: { N: -20, E: 20, S: 0, W: 0 },
        chips: { N: 980, E: 1020, S: 0, W: 0 }, timestamp: 6 },
    ];
    const [round] = deriveRoundHistory({ gameType: 'blackjack', phase: 'betting', seats: ['N', 'E'], log: dealt });
    expect(round.actions.map((action) => [action.kind, action.seat, action.net])).toEqual([
      ['deal', 'E', undefined], ['deal', null, undefined], ['stand', 'E', undefined], ['dealerReveal', null, undefined],
      ['dealerStand', null, undefined], ['settle', 'E', 20], ['settle', 'N', -20],
    ]);
    expect(replayBlackjack(dealt, ['N', 'E'], 5)).toMatchObject({ dealerSeat: 'N', dealerTurn: true });
    const nextBetting = { ...dealing, phase: 'betting' as const, dealerSeat: 'E' as const, log: dealt, presentation: undefined };
    expect(blackjackView(nextBetting, null)).toMatchObject({ dealerSeat: 'N', currentDealer: 'E', betting: true });
  });

  it('should rank final chips with shared places and report net results', () => {
    expect(rankBlackjack({
      gameType: 'blackjack', chips: { N: 1200, E: 700, S: 1200, W: 900 }, hands: 8, winners: ['N', 'S'],
    })).toEqual([
      { seat: 'N', place: 1, chips: 1200, net: 200, winner: true },
      { seat: 'S', place: 1, chips: 1200, net: 200, winner: true },
      { seat: 'W', place: 3, chips: 900, net: -100, winner: false },
      { seat: 'E', place: 4, chips: 700, net: -300, winner: false },
    ]);
    expect(rankBlackjack({
      gameType: 'blackjack', seats: ['E', 'S'], chips: { N: 0, E: 0, S: 0, W: 0 }, hands: 8, winners: ['E', 'S'],
    }).map((row) => [row.seat, row.place, row.winner])).toEqual([['E', 1, true], ['S', 1, true]]);
    expect(handNet({ bet: 20 }, 'blackjack')).toBe(30);
    expect(handNet({ bet: 20 }, 'push')).toBe(0);
    expect(handNet({ bet: 40 }, 'bust')).toBe(-40);
    expect([signedChips(15), signedChips(-10), signedChips(0)]).toEqual(['+15', '−10', '±0']);
  });

  it('should list each hand as a history round with dealer draws and settlement', () => {
    const rounds = deriveRoundHistory({ gameType: 'blackjack', phase: 'playing', seats: ALL, log });
    expect(rounds.map((round) => round.complete)).toEqual([true, false]);
    const [first] = rounds;
    expect(first.actions.filter((action) => action.kind === 'deal').map((action) => action.seat))
      .toEqual(['N', 'E', 'S', 'W', null]);
    expect(first.actions.find((action) => action.kind === 'deal' && action.seat === 'S'))
      .toMatchObject({ bet: 10, auto: true, handTotal: 16 });
    expect(first.actions.find((action) => action.kind === 'double' && action.seat === 'S'))
      .toMatchObject({ handIndex: 0, handTotal: 21 });
    expect(first.actions.find((action) => action.kind === 'dealerHit')).toMatchObject({ seat: null, handTotal: 20 });
    expect(first.actions.filter((action) => action.kind === 'settle').map((action) => action.net)).toEqual([50, 30, 10, 0]);
    expect(deriveRoundHistory(structuredClone({ gameType: 'blackjack' as const, phase: 'playing' as const, seats: ALL, log })))
      .toEqual(rounds);
  });

});
