import { describe, expect, it } from 'vitest';
import { getPresentationFrames } from '@shared/game-presentation';
import { heAward, heEliminations, heReplay } from '@shared/rules/holdem';
import type { Card, HoldemLogEntry, HoldemMatchResult, HoldemVisibleState } from '@shared/types';
import {
  chipsAdded, clampRaise, holdemBlindSeats, holdemCategory, holdemControls, holdemView, nextHeldHoleCards, potLines,
  potTotal, quickRaise, raiseKind, rankHoldem, recentHoldemMoves, replayHoldem, seatState, shownHoleCards,
  signedChips, streetActions,
} from '../../../client/src/games/holdem/holdem-view';
import type { HoldemTableView } from '../../../client/src/games/holdem/holdem-view';
import { deriveRoundHistory } from '../../../client/src/games/round-history';
import { holdemTranslations } from '../../../client/src/holdem-i18n';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/** The award entry the server would log for the table so far. */
function award(log: readonly HoldemLogEntry[]): HoldemLogEntry {
  const table = heReplay(log);
  const { pots, payouts } = heAward(table);
  const chips = { N: table.chips.N + payouts.N, E: table.chips.E + payouts.E, S: table.chips.S + payouts.S,
    W: table.chips.W + payouts.W };
  return { type: 'award', pots, chips, eliminated: heEliminations(table, chips), timestamp: 0 };
}

const NORTH_HOLE = [c(13, 'hearts'), c(13, 'diamonds')];
const WEST_HOLE = [c(12, 'hearts'), c(12, 'diamonds')];

/**
 * Hand 1 (button N, blinds E/S): W limps, N raises to 60, E folds, S and W call. On the flop S
 * checks, W bets 100, N calls, S folds; turn checks through; W bets 200 on the river and N calls.
 * N's kings beat W's queens at showdown, then hand 2 is dealt with the button on E.
 */
function buildLog(): HoldemLogEntry[] {
  const log: HoldemLogEntry[] = [
    { type: 'hand', hand: 1, button: 'N', smallBlind: 10, bigBlind: 20, blinds: { N: 0, E: 10, S: 20, W: 0 }, timestamp: 1 },
    { type: 'action', seat: 'W', action: 'call', to: 20, allIn: false, timestamp: 2 },
    { type: 'action', seat: 'N', action: 'raise', to: 60, allIn: false, timestamp: 3 },
    { type: 'action', seat: 'E', action: 'fold', to: 10, allIn: false, timestamp: 4 },
    { type: 'action', seat: 'S', action: 'call', to: 60, allIn: false, timestamp: 5 },
    { type: 'action', seat: 'W', action: 'call', to: 60, allIn: false, timestamp: 6 },
    { type: 'street', street: 'flop', cards: [c(13, 'spades'), c(7, 'hearts'), c(2, 'diamonds')], timestamp: 7 },
    { type: 'action', seat: 'S', action: 'check', to: 0, allIn: false, timestamp: 8 },
    { type: 'action', seat: 'W', action: 'bet', to: 100, allIn: false, timestamp: 9 },
    { type: 'action', seat: 'N', action: 'call', to: 100, allIn: false, timestamp: 10 },
    { type: 'action', seat: 'S', action: 'fold', to: 0, allIn: false, timestamp: 11 },
    { type: 'street', street: 'turn', cards: [c(9, 'clubs')], timestamp: 12 },
    { type: 'action', seat: 'W', action: 'check', to: 0, allIn: false, timestamp: 13 },
    { type: 'action', seat: 'N', action: 'check', to: 0, allIn: false, timestamp: 14 },
    { type: 'street', street: 'river', cards: [c(4, 'spades')], timestamp: 15 },
    { type: 'action', seat: 'W', action: 'bet', to: 200, allIn: false, timestamp: 16 },
    { type: 'action', seat: 'N', action: 'call', to: 200, allIn: false, timestamp: 17 },
    { type: 'showdown', cards: { N: NORTH_HOLE, E: [], S: [], W: WEST_HOLE }, timestamp: 18 },
  ];
  log.push(award(log));
  log.push({ type: 'hand', hand: 2, button: 'E', smallBlind: 10, bigBlind: 20, blinds: { N: 0, E: 0, S: 10, W: 20 },
    timestamp: 20 });
  return log;
}

const log = buildLog();
const SOUTH_HAND_1 = [c(8, 'clubs'), c(3, 'hearts')];
const SOUTH_HAND_2 = [c(14, 'spades'), c(14, 'clubs')];

/** A player's visible state after the first `end` entries, as the server would send it. */
function visible(end: number, overrides: Partial<HoldemVisibleState> = {}): HoldemVisibleState {
  const table = heReplay(log, end);
  return {
    gameType: 'holdem', phase: 'playing', mySeat: 'S', myHand: SOUTH_HAND_2, ...table, currentTurnSeat: 'N',
    log: log.slice(0, end), result: null, presentation: { id: 'p', startedAt: 0, logStart: 15, timingVersion: 2 },
    ...overrides,
  };
}

describe("Texas Hold'em table view", () => {
  it('should rebuild the board, showdown, award, and next blinds only at their frames', () => {
    const state = visible(log.length);
    const frames = getPresentationFrames(state);
    expect(frames.map((frame) => frame.kind)).toEqual(['bet', 'call', 'showdown', 'award', 'deal']);
    const [bet, , showdown, awarded, deal] = frames;

    const betting = holdemView(state, bet);
    expect(betting).toMatchObject({ hand: 1, street: 'river', logEnd: 16, award: null });
    expect(betting.board).toHaveLength(5);
    expect(betting.streetBets.W).toBe(200);
    expect(betting.revealed.N).toEqual([]);

    expect(holdemView(state, showdown).revealed).toMatchObject({ N: NORTH_HOLE, W: WEST_HOLE });

    const paid = holdemView(state, awarded);
    expect(paid.hand).toBe(1);
    expect(paid.award?.payouts).toEqual({ N: 790, E: 0, S: 0, W: 0 });
    expect(paid.award?.pots[0]).toMatchObject({ amount: 790, winners: ['N'] });
    expect(paid.chips.N).toBe(1000 - 360 + 790);
    expect(holdemBlindSeats(paid)).toEqual({ button: 'N', small: 'E', big: 'S' });

    const dealt = holdemView(state, deal);
    expect(dealt).toMatchObject({ hand: 2, button: 'E', award: null, board: [] });
    expect(holdemBlindSeats(dealt)).toEqual({ button: 'E', small: 'S', big: 'W' });
  });

  it('should use the visible state without a frame or on the closing frame', () => {
    const state = visible(log.length);
    expect(holdemView(state, null)).toMatchObject({ hand: 2, logEnd: log.length, award: null });
    const finish = { key: 'p:finish', kind: 'finish' as const, durationMs: 3000, cards: [] };
    expect(holdemView(state, finish).hand).toBe(2);
    // Between the award and the next deal the result stays on the table.
    const afterAward = visible(log.length - 1);
    expect(holdemView(afterAward, null).award?.payouts.N).toBe(790);
    expect(replayHoldem(log, log.length - 1).award?.eliminated).toEqual([]);
  });

  it('should keep the next hand hole cards hidden until its deal frame', () => {
    const state = visible(log.length);
    const [bet, , , awarded, deal] = getPresentationFrames(state);
    const held = { hand: 1, cards: SOUTH_HAND_1 };
    expect(shownHoleCards(state, holdemView(state, awarded), held)).toEqual({ cards: SOUTH_HAND_1, hidden: false });
    expect(shownHoleCards(state, holdemView(state, awarded), null)).toEqual({ cards: [], hidden: true });
    expect(shownHoleCards(state, holdemView(state, deal), held)).toEqual({ cards: SOUTH_HAND_2, hidden: false });
    expect(shownHoleCards(state, holdemView(state, null), null).cards).toBe(SOUTH_HAND_2);
    // A showdown reveals the seat's own earlier cards even when nothing was remembered.
    const north = visible(log.length, { mySeat: 'N', myHand: [c(2, 'clubs'), c(3, 'clubs')] });
    expect(shownHoleCards(north, holdemView(north, awarded), null).cards).toEqual(NORTH_HOLE);
    expect(shownHoleCards(north, holdemView(north, bet), null).hidden).toBe(true);
    // Before the first deal no seat holds cards.
    expect(shownHoleCards(visible(0), replayHoldem(log, 0), null)).toEqual({ cards: [], hidden: false });
  });

  it('should remember the previous hand hole cards when a new hand arrives', () => {
    const hand1 = { hand: 1, myHand: SOUTH_HAND_1 };
    const hand2 = { hand: 2, myHand: SOUTH_HAND_2 };
    const held = nextHeldHoleCards(hand1, hand2, null);
    expect(held).toEqual({ hand: 1, cards: SOUTH_HAND_1 });
    expect(nextHeldHoleCards(hand2, hand2, held)).toBe(held);
    expect(nextHeldHoleCards(hand2, { hand: 3 }, held)).toEqual({ hand: 2, cards: SOUTH_HAND_2 });
    expect(nextHeldHoleCards(null, hand1, null)).toBeNull();
    // An eliminated seat holds no cards, so nothing is remembered.
    expect(nextHeldHoleCards({ hand: 4, myHand: [] }, { hand: 5 }, held)).toBeNull();
  });

  it('should derive the legal controls for the local seat', () => {
    // After N raises to 60, E (small blind, 990 behind) must act.
    const facingRaise = visible(3, { mySeat: 'E', currentTurnSeat: 'E' });
    const controls = holdemControls(facingRaise, true);
    expect(controls).toEqual({ check: false, call: 50, callAllIn: false, raise: { min: 100, max: 1000, bet: false } });
    expect(holdemControls(facingRaise, false)).toBeNull();
    expect(holdemControls({ ...facingRaise, currentTurnSeat: 'S' }, true)).toBeNull();
    expect(holdemControls({ ...facingRaise, phase: 'scoring' }, true)).toBeNull();

    // On the flop nothing is bet, so S may check or bet at least the big blind.
    const flop = visible(7, { mySeat: 'S', currentTurnSeat: 'S' });
    expect(holdemControls(flop, true)).toEqual({ check: true, call: 0, callAllIn: false,
      raise: { min: 20, max: 940, bet: true } });

    // A short stack can only call all-in and cannot raise.
    const short = { ...facingRaise, chips: { ...facingRaise.chips, E: 50 } };
    expect(holdemControls(short, true)).toEqual({ check: false, call: 50, callAllIn: true, raise: null });
  });

  it('should clamp raise sizes and label the confirm button', () => {
    const facingRaise = visible(3, { mySeat: 'E', currentTurnSeat: 'E' });
    const range = { min: 100, max: 1000, bet: false };
    expect(clampRaise(5000, range)).toBe(1000);
    expect(clampRaise(50, range)).toBe(100);
    expect(clampRaise(150.6, range)).toBe(151);
    expect(clampRaise(Number.NaN, range)).toBe(100);
    // Pot 110; calling 50 makes 160, so a pot raise goes to 60 + 160 and half pot to 60 + 80.
    expect(potTotal(facingRaise)).toBe(110);
    expect(quickRaise('min', facingRaise, 'E', range)).toBe(100);
    expect(quickRaise('halfPot', facingRaise, 'E', range)).toBe(140);
    expect(quickRaise('pot', facingRaise, 'E', range)).toBe(220);
    expect(quickRaise('allIn', facingRaise, 'E', range)).toBe(1000);
    expect(quickRaise('pot', facingRaise, 'E', { min: 100, max: 180 })).toBe(180);
    expect(quickRaise('halfPot', facingRaise, 'E', { min: 150, max: 1000 })).toBe(150);
    expect(raiseKind(220, range)).toBe('raise');
    expect(raiseKind(1000, range)).toBe('allIn');
    expect(raiseKind(40, { min: 20, max: 940, bet: true })).toBe('bet');
  });

  it('should split main and side pots without counting open street bets', () => {
    const base = replayHoldem(log, 0);
    const table: HoldemTableView = {
      ...base, hand: 3, dealt: ['N', 'E', 'S', 'W'], folded: ['W'], street: 'turn',
      totalBets: { N: 400, E: 100, S: 300, W: 20 }, streetBets: { N: 100, E: 0, S: 0, W: 0 },
    };
    expect(potTotal(table)).toBe(820);
    // N's uncalled 100 stays in front of N; folded W's 20 joins the main pot.
    expect(potLines(table)).toEqual([
      { amount: 320, eligible: ['N', 'E', 'S'], winners: [], returned: false },
      { amount: 400, eligible: ['N', 'S'], winners: [], returned: false },
    ]);
    const awarded: HoldemTableView = { ...table, award: {
      pots: [{ amount: 320, eligible: ['N', 'E', 'S'], winners: ['E'] }, { amount: 100, eligible: ['N'], winners: ['N'] }],
      payouts: { N: 100, E: 320, S: 0, W: 0 }, eliminated: [],
    } };
    expect(potLines(awarded).map((line) => line.returned)).toEqual([false, true]);
    expect(potLines(awarded)[0].winners).toEqual(['E']);
  });

  it('should describe seats, street actions, added chips, and hand categories', () => {
    const flop = replayHoldem(log, 10);
    expect(streetActions(log, 10)).toEqual({ S: 'check', W: 'bet', N: 'call' });
    expect(streetActions(log, 7)).toEqual({});
    expect(seatState(flop, 'E')).toBe('folded');
    expect(seatState(flop, 'N')).toBe('active');
    expect(seatState(replayHoldem(log, 0), 'N')).toBe('waiting');
    const allIn = { ...flop, chips: { ...flop.chips, W: 0 } };
    expect(seatState(allIn, 'W')).toBe('allIn');
    expect(seatState({ ...flop, eliminated: ['W'] }, 'W')).toBe('out');
    expect(chipsAdded(log, 1)).toBe(20);
    expect(chipsAdded(log, 4)).toBe(40);
    expect(chipsAdded(log, 5)).toBe(40);
    expect(chipsAdded(log, 9)).toBe(100);
    expect(chipsAdded(log, 0)).toBe(0);
    expect(holdemCategory(NORTH_HOLE, flop.board)).toBe('threeOfAKind');
    expect(holdemCategory(NORTH_HOLE, [])).toBeNull();
    expect(recentHoldemMoves(log, 3, 2).map((entry) => entry.timestamp)).toEqual([3, 2]);
    expect(signedChips(30)).toBe('+30');
    expect(signedChips(-5)).toBe('−5');
    expect(signedChips(0)).toBe('±0');
  });

  it('should rank by chips, then busted seats by reverse elimination order', () => {
    const result: HoldemMatchResult = { gameType: 'holdem', chips: { N: 2500, E: 0, S: 1500, W: 0 }, hands: 14,
      winners: ['N'], eliminationOrder: ['W', 'E'] };
    expect(rankHoldem(result).map((row) => [row.seat, row.place, row.net, row.eliminated])).toEqual([
      ['N', 1, 1500, false], ['S', 2, 500, false], ['E', 3, -1000, true], ['W', 4, -1000, true],
    ]);
    const tied: HoldemMatchResult = { ...result, chips: { N: 2000, E: 0, S: 2000, W: 0 }, winners: ['N', 'S'],
      eliminationOrder: ['E', 'W'] };
    expect(rankHoldem(tied).map((row) => [row.seat, row.place, row.winner])).toEqual([
      ['N', 1, true], ['S', 1, true], ['W', 3, false], ['E', 4, false],
    ]);
  });

  it('should list each hand as a history round with blinds, amounts, showdown, and winnings', () => {
    const rounds = deriveRoundHistory(visible(log.length));
    expect(rounds).toHaveLength(2);
    const [first, second] = rounds;
    expect(first.complete).toBe(true);
    expect(first.actions.slice(0, 8)).toEqual([
      { kind: 'button', seat: 'N', cards: [], blinds: { small: 10, big: 20 } },
      { kind: 'blind', seat: 'E', cards: [], amount: 10 },
      { kind: 'blind', seat: 'S', cards: [], amount: 20 },
      { kind: 'call', seat: 'W', cards: [], amount: 20 },
      { kind: 'raise', seat: 'N', cards: [], amount: 60 },
      { kind: 'fold', seat: 'E', cards: [] },
      { kind: 'call', seat: 'S', cards: [], amount: 40 },
      { kind: 'call', seat: 'W', cards: [], amount: 40 },
    ]);
    expect(first.actions[8]).toMatchObject({ kind: 'street', seat: null, street: 'flop' });
    expect(first.actions.filter((action) => action.kind === 'showdown')).toEqual([
      { kind: 'showdown', seat: 'N', cards: NORTH_HOLE, category: 'threeOfAKind' },
      { kind: 'showdown', seat: 'W', cards: WEST_HOLE, category: 'pair' },
    ]);
    expect(first.actions.at(-1)).toEqual({ kind: 'award', seat: 'N', cards: [], amount: 790 });
    expect(second).toMatchObject({ number: 2, complete: false });
    expect(second.actions.map((action) => action.kind)).toEqual(['button', 'blind', 'blind']);
  });

  it('should list eliminations after the winnings in history', () => {
    const shortLog: HoldemLogEntry[] = [
      { type: 'hand', hand: 1, button: 'N', smallBlind: 10, bigBlind: 20, blinds: { N: 0, E: 10, S: 20, W: 0 }, timestamp: 1 },
      { type: 'action', seat: 'W', action: 'raise', to: 1000, allIn: true, timestamp: 2 },
      { type: 'action', seat: 'N', action: 'call', to: 1000, allIn: true, timestamp: 3 },
      { type: 'action', seat: 'E', action: 'fold', to: 10, allIn: false, timestamp: 4 },
      { type: 'action', seat: 'S', action: 'fold', to: 20, allIn: false, timestamp: 5 },
      { type: 'street', street: 'flop', cards: [c(13, 'spades'), c(7, 'hearts'), c(2, 'diamonds')], timestamp: 6 },
      { type: 'street', street: 'turn', cards: [c(9, 'clubs')], timestamp: 7 },
      { type: 'street', street: 'river', cards: [c(4, 'spades')], timestamp: 8 },
      { type: 'showdown', cards: { N: NORTH_HOLE, E: [], S: [], W: WEST_HOLE }, timestamp: 9 },
    ];
    shortLog.push(award(shortLog));
    const [round] = deriveRoundHistory({ gameType: 'holdem', phase: 'playing', log: shortLog });
    expect(round.actions.slice(-2)).toEqual([
      { kind: 'award', seat: 'N', cards: [], amount: 2030 },
      { kind: 'eliminated', seat: 'W', cards: [] },
    ]);
    expect(round.actions[3]).toEqual({ kind: 'allIn', seat: 'W', cards: [], amount: 1000 });
    expect(seatState(replayHoldem(shortLog, shortLog.length), 'W')).toBe('out');
  });

  it('should translate every key in both languages', () => {
    const english = Object.keys(holdemTranslations.en).sort();
    expect(Object.keys(holdemTranslations['zh-TW']).sort()).toEqual(english);
    for (const locale of ['en', 'zh-TW'] as const) {
      for (const value of Object.values(holdemTranslations[locale])) expect(value.trim()).not.toBe('');
    }
  });
});
