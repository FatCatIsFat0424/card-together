import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BigTwoGameState, Card, PlayerInfo, Seat } from '@shared/types';
import { frameLogIndex, getPresentationEndsAt, getPresentationFrames } from '@shared/game-presentation';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import * as games from '../../src/managers/game-manager';

const CODE = 'PRES01';
const card = (rank: Card['rank']): Card => ({ suit: 'clubs', rank });
const player = (id: string): PlayerInfo => ({
  id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null,
});
const players: Record<Seat, PlayerInfo> = {
  N: player('north'), E: player('east'), S: player('south'), W: player('west'),
};

function restore(): BigTwoGameState {
  const state: BigTwoGameState = {
    gameType: 'bigtwo', id: 'presentation-test', startedAt: 1, roomCode: CODE, players,
    phase: 'playing', hands: { N: [card(3), card(4)], E: [card(7)], S: [card(6)], W: [card(5)] },
    currentTurnSeat: 'N', lastPlay: null, lockedSeats: [], firstPlay: false, log: [], result: null,
  };
  games.restoreGames([state]);
  return games.getGameState(CODE) as BigTwoGameState;
}

describe('authoritative game presentation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); games.restoreGames([]); });
  afterEach(() => { games.restoreGames([]); vi.useRealTimers(); });

  it('should reject early actions without mutations and accept the exact deadline', () => {
    restore();
    expect(games.handleBigTwoPlay(CODE, 'N', [card(3)]).success).toBe(true);
    const state = games.getGameState(CODE)!;
    const before = structuredClone(state);
    const endsAt = getPresentationEndsAt(state);
    expect(endsAt - Date.now()).toBe(1300);
    expect(state.presentation?.timingVersion).toBe(2);
    vi.setSystemTime(endsAt - 1);
    expect(games.handleBigTwoPlay(CODE, 'W', [card(5)]).success).toBe(false);
    expect(games.handleBigTwoPass(CODE, 'W').success).toBe(false);
    expect(games.getGameState(CODE)).toEqual(before);
    vi.setSystemTime(endsAt);
    expect(games.handleBigTwoPlay(CODE, 'W', [card(5)]).success).toBe(true);
    expect(getPresentationFrames(games.getGameState(CODE)!).map((frame) => frame.kind))
      .toEqual(['play', 'finish']);
  });

  it('should leave invalid actions unchanged and restore deadlines without timers', () => {
    restore();
    const before = structuredClone(games.exportGames());
    expect(games.handleBigTwoPlay(CODE, 'W', [card(5)]).success).toBe(false);
    expect(games.exportGames()).toEqual(before);
    games.handleBigTwoPlay(CODE, 'N', [card(3)]);
    const snapshot = structuredClone(games.exportGames());
    games.restoreGames(snapshot);
    expect(games.exportGames()).toEqual(snapshot);
    expect(games.isPresentationActive(CODE)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    const visible = games.getPlayerVisibleState(CODE, 'S')!;
    expect(visible.presentation?.serverNow).toBe(10000);
    expect(snapshot[0].presentation?.serverNow).toBeUndefined();
    expect(getPresentationFrames(visible)).toEqual(getPresentationFrames(snapshot[0]));
  });

  it('should serialize automatic passes and the new leader after the played cards', () => {
    const state = restore();
    state.hands.N = [{ suit: 'spades', rank: 2 }, card(3)];
    games.handleBigTwoPlay(CODE, 'N', [{ suit: 'spades', rank: 2 }]);
    expect(getPresentationFrames(state).map(({ kind }) => kind)).toEqual(['play']);
    for (const seat of ['W', 'S', 'E']) {
      const pending = state.pendingAutoPass!;
      expect(pending.seat).toBe(seat);
      vi.setSystemTime(pending.executeAt);
      expect(games.handlePendingAutoPass(CODE, state.id, pending.id).success).toBe(true);
    }
    expect(getPresentationFrames(state).map(({ kind, seat }) => ({ kind, seat }))).toEqual([
      { kind: 'pass', seat: 'E' }, { kind: 'round', seat: 'N' },
    ]);
    expect(getPresentationEndsAt(state)).toBe(Date.now() + 3000);
    expect(getPresentationFrames(state).at(-1)).toMatchObject({
      cards: [{ suit: 'spades', rank: 2 }], passedSeats: ['W', 'S', 'E'],
    });
  });

  it('should show public red-points captures in log order with points', () => {
    games.startGame(CODE, 'redpoints', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'redpoints') throw new Error('Expected red points');
    state.log = [
      { type: 'play', seat: 'N', card: { suit: 'hearts', rank: 3 }, captured: { suit: 'diamonds', rank: 7 }, timestamp: 1 },
      { type: 'flip', seat: 'N', card: card(9), captured: null, timestamp: 1 },
    ];
    state.presentation = { id: 'capture', startedAt: 10000, logStart: 0 };
    expect(getPresentationFrames(state)).toMatchObject([
      { kind: 'capture', seat: 'N', points: 10, durationMs: 1900 },
      { kind: 'play', seat: 'N', points: 0, cards: [card(9)], durationMs: 1900 },
    ]);
    expect(getPresentationFrames(games.getPlayerVisibleState(CODE, 'W')!))
      .toEqual(getPresentationFrames(state));
  });

  it('should show 99 total and elimination before finishing', () => {
    games.startGame(CODE, 'ninetynine', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'ninetynine') throw new Error('Expected 99');
    state.phase = 'scoring';
    state.log = [
      { type: 'play', seat: 'N', card: card(13), choice: null, target: null, total: 99, timestamp: 1 },
      { type: 'eliminated', seat: 'W', timestamp: 1 },
    ];
    state.presentation = { id: 'finish', startedAt: 10000, logStart: 0 };
    expect(getPresentationFrames(state)).toMatchObject([
      { kind: 'play', total: 99, previousTotal: 0, durationMs: 1900 },
      { kind: 'eliminated', seat: 'W', durationMs: 2500 },
      { kind: 'finish', durationMs: 3000, cards: [card(13)] },
    ]);
    expect(getPresentationEndsAt(state)).toBe(17400);
    state.log.unshift({ type: 'play', seat: 'E', card: card(9), choice: null,
      target: null, total: 9, timestamp: 0 });
    state.presentation = { ...state.presentation, logStart: 1 };
    expect(getPresentationFrames(state)[0]).toMatchObject({ previousTotal: 9, total: 99 });
  });

  it('should present Sevens covers without revealing the covered card', () => {
    games.startGame(CODE, 'sevens', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'sevens') throw new Error('Expected Sevens');
    state.log = [
      { type: 'play', seat: 'N', card: { suit: 'spades', rank: 7 }, timestamp: 1 },
      { type: 'cover', seat: 'W', timestamp: 1 },
    ];
    state.presentation = { id: 'sevens', startedAt: 10000, logStart: 0, timingVersion: 2 };
    expect(getPresentationFrames(state)).toEqual([
      { key: 'sevens:0', kind: 'play', durationMs: 1300, seat: 'N', cards: [{ suit: 'spades', rank: 7 }] },
      { key: 'sevens:1', kind: 'cover', durationMs: 1000, seat: 'W', cards: [] },
    ]);
  });

  it("should open Liar's Deck with the table card and resolve a pull only after its suspense", () => {
    games.startGame(CODE, 'liarsdeck', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'liarsdeck') throw new Error("Expected Liar's Deck");
    expect(getPresentationFrames(state)).toEqual([expect.objectContaining({
      kind: 'deal', durationMs: 2000, seat: state.currentTurnSeat, tableFace: state.tableFace, cards: [] })]);
    expect(state.clock?.turn?.startsAt).toBe(getPresentationEndsAt(state));
    vi.setSystemTime(getPresentationEndsAt(state));
    const opener = state.currentTurnSeat;
    expect(games.handleLiarsDeckPlay(CODE, opener, [state.hands[opener][0].id]).success).toBe(true);
    expect(getPresentationFrames(state)).toEqual([
      expect.objectContaining({ kind: 'play', seat: opener, count: 1, cards: [] })]);
    expect(getPresentationFrames(state)[0]).not.toHaveProperty('liarFaces');
    vi.setSystemTime(getPresentationEndsAt(state));
    const caller = state.currentTurnSeat;
    expect(games.handleLiarsDeckChallenge(CODE, caller).success).toBe(true);
    const frames = getPresentationFrames(state);
    expect(frames.map((frame) => frame.kind)).toEqual(state.phase === 'scoring'
      ? ['challenge', 'roulette', 'shot', 'finish'] : ['challenge', 'roulette', 'shot', 'deal']);
    expect(frames[0]).toMatchObject({ seat: caller, target: opener, durationMs: 2500 });
    expect(frames[0].liarFaces).toHaveLength(1);
    expect(frames[1]).not.toHaveProperty('survived');
    expect(frames[2]).toMatchObject({ shot: 1, survived: expect.any(Boolean), durationMs: 1500 });
    expect(frameLogIndex(frames[1])).toBe(frameLogIndex(frames[2]));
  });

  it('should keep Blackjack bets frameless, start the first turn after the deal, and open betting after settlement', () => {
    games.startGame(CODE, 'blackjack', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'blackjack') throw new Error('Expected Blackjack');
    expect(state.clock?.turn).toBeNull();
    expect(state.betDeadline).toBe(Date.now() + 15_000);
    for (const seat of ['N', 'E', 'S'] as const) {
      expect(games.handleBlackjackBet(CODE, seat, 50).success).toBe(true);
      expect(getPresentationFrames(state)).toEqual([]);
    }
    const bank = state.clock!.bankRemainingMs.N;
    expect(games.handleBlackjackBet(CODE, 'W', 50).success).toBe(true);
    const frames = getPresentationFrames(state);
    expect(frames[0]).toMatchObject({ kind: 'deal', durationMs: 1800, cards: [] });
    if (state.phase === 'playing') {
      expect(frames).toHaveLength(1);
      expect(state.clock?.turn).toMatchObject({ seat: state.currentTurnSeat, startsAt: getPresentationEndsAt(state) });
      expect(state.clock?.bankRemainingMs.N).toBe(bank);
      vi.setSystemTime(getPresentationEndsAt(state) - 1);
      expect(games.handleBlackjackAction(CODE, state.currentTurnSeat, 'stand').success).toBe(false);
      vi.setSystemTime(getPresentationEndsAt(state));
      while (state.phase === 'playing') {
        expect(games.handleBlackjackAction(CODE, state.currentTurnSeat, 'stand').success).toBe(true);
        vi.setSystemTime(getPresentationEndsAt(state));
      }
    }
    expect(state.phase).toBe('betting');
    const kinds = getPresentationFrames(state).map((frame) => frame.kind);
    expect(kinds.slice(-1)).toEqual(['settle']);
    expect(kinds).toContain('dealerReveal');
    expect(state.clock?.turn).toBeNull();
    expect(state.betDeadline).toBe(getPresentationEndsAt(state) + 15_000);
  });

  it('should let Chinese Poker seats submit without waiting and present only the showdown', () => {
    games.startGame(CODE, 'chinesepoker', players);
    const hands = (games.getGameState(CODE) as { hands: Record<Seat, Card[]> }).hands;
    for (const seat of ['N', 'E', 'S'] as const) {
      expect(games.handleChinesePokerArrange(CODE, seat, cpGreedyArrangement(hands[seat]))).toEqual({ success: true });
      expect(games.isPresentationActive(CODE)).toBe(false);
    }
    expect(games.handleChinesePokerArrange(CODE, 'W', cpGreedyArrangement(hands.W))).toEqual({ success: true });
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'chinesepoker' || !state.result) throw new Error('Expected a finished Chinese Poker game');
    const frames = getPresentationFrames(state);
    expect(frames.slice(0, 3).map((frame) => [frame.kind, frame.row, frame.durationMs])).toEqual([
      ['reveal', 'front', 2500], ['reveal', 'middle', 2500], ['reveal', 'back', 2500],
    ]);
    expect(frames.filter((frame) => frame.kind === 'shoot'))
      .toHaveLength(state.result.matchups.filter((matchup) => matchup.shooter).length);
    expect(frames.at(-1)).toMatchObject({ kind: 'finish', durationMs: 3000 });
    expect(games.isPresentationActive(CODE)).toBe(true);
  });

  it('should preserve all four bridge trick cards after the engine clears the table', () => {
    games.startGame(CODE, 'bridge', players);
    const state = games.getGameState(CODE)!;
    if (state.gameType !== 'bridge') throw new Error('Expected bridge');
    const cards = { N: card(3), E: card(4), S: card(5), W: card(6) };
    state.playing = { currentTrick: {}, trickLeadSeat: 'W', currentTurnSeat: 'W',
      completedTricks: [{ cards, leadSeat: 'N', winnerSeat: 'W' }], trickCountEW: 1, trickCountNS: 0 };
    state.log = [{ type: 'trick_end', winnerSeat: 'W', trickIndex: 1, timestamp: 1 }];
    state.presentation = { id: 'trick', startedAt: 10000, logStart: 0 };
    expect(getPresentationFrames(state)).toEqual([{
      key: 'trick:0', kind: 'trick', durationMs: 2000, seat: 'W',
      cards: Object.values(cards), cardSeats: ['N', 'E', 'S', 'W'],
    }]);
    delete state.presentation;
    expect(getPresentationFrames(state)).toEqual([]);
    expect(getPresentationEndsAt(state)).toBe(0);
  });
});
