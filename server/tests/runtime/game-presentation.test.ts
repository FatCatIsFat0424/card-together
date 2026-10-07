import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BigTwoGameState, Card, PlayerInfo, Seat } from '@shared/types';
import { getPresentationEndsAt, getPresentationFrames } from '@shared/game-presentation';
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
