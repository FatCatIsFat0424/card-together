import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'node:crypto';
import { getPresentationEndsAt } from '@shared/game-presentation';
import * as manager from '../../src/managers/game-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import { startBigTwoAutoPass } from '../../src/runtime/bigtwo-auto-pass';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import type { BigTwoGameState, Card, PlayerInfo, Seat } from '@shared/types';
import { createDeck } from '../../src/engine/deck';
import * as bigtwo from '../../src/managers/games/bigtwo-game';

vi.mock('node:crypto', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:crypto')>(), randomInt: vi.fn(() => 1500),
}));

const CODE = 'AUTO01';
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];

function card(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

function player(id: string): PlayerInfo {
  return { id, username: id, nickname: id, color: '#123456', avatar: 'cat', avatarImage: null };
}

function game(): BigTwoGameState {
  const state = bigtwo.getGameState(CODE);
  if (!state) throw new Error('Expected a Big Two game');
  return state;
}

function restoreHands(hands: Record<Seat, Card[]>): void {
  const held = SEATS.flatMap((seat) => hands[seat]);
  const played = createDeck().filter((entry) => !held.some((own) =>
    own.suit === entry.suit && own.rank === entry.rank));
  const log: BigTwoGameState['log'] = [];
  for (const seat of SEATS) {
    for (const entry of played.splice(0, 13 - hands[seat].length)) {
      log.push({ type: 'play', seat, cards: [entry], comboType: 'single', timestamp: log.length });
    }
  }
  log.push({ type: 'round_end', leaderSeat: 'N', timestamp: log.length });
  bigtwo.restoreGames([{
    gameType: 'bigtwo', id: 'auto-pass-game', roomCode: CODE, startedAt: 1,
    players: { N: player('north'), E: player('east'), S: player('south'), W: player('west') },
    phase: 'playing', hands, currentTurnSeat: 'N', lastPlay: null,
    lockedSeats: [], firstPlay: false, log, result: null,
  }]);
}

function singleHands(): Record<Seat, Card[]> {
  return {
    N: [card('spades', 2), card('clubs', 3)],
    W: [card('clubs', 4)], S: [card('clubs', 5)], E: [card('clubs', 6)],
  };
}

function snapshot(): RuntimeSnapshot {
  const state = structuredClone(game());
  return {
    players: SEATS.map((seat) => ({ info: state.players[seat], currentRoomCode: CODE, disconnectedAt: null })),
    rooms: [{ info: { code: CODE, gameType: 'bigtwo', status: 'playing', createdAt: 1,
      hostId: state.players.N.id, abortVote: null, abortVoteCooldownUntil: null,
      seats: { N: { player: state.players.N, isReady: true }, E: { player: state.players.E, isReady: true },
        S: { player: state.players.S, isReady: true }, W: { player: state.players.W, isReady: true } } },
      memberIds: SEATS.map((seat) => state.players[seat].id) }],
    games: [state], chat: [{ roomCode: CODE, messages: [] }],
  };
}

function automaticPass(): void {
  const state = game();
  const pending = state.pendingAutoPass;
  if (!pending) throw new Error('Expected automatic pass');
  vi.setSystemTime(pending.executeAt);
  expect(manager.handlePendingAutoPass(CODE, state.id, pending.id)).toEqual({ success: true });
}

describe('Big Two delayed automatic passing', () => {
  beforeEach(() => { vi.mocked(crypto.randomInt).mockReset().mockReturnValue(1500); vi.useFakeTimers(); vi.setSystemTime(10000); manager.restoreGames([]); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); manager.restoreGames([]); });

  it('lets forced passes own their turns without spending the thinking bank or duplicating actions', async () => {
    restoreHands(singleHands());
    let saved = snapshot();
    const runtime = await createRuntimeCoordinator({
      loadRuntime: async () => structuredClone(saved),
      saveRuntime: async (state) => {
        expect(isRuntimeSnapshot(state)).toBe(true);
        saved = structuredClone(state);
      },
    });
    const timed = vi.fn();
    const forced = vi.fn();
    const stopTimers = await startTurnTimers(runtime, timed);
    const stopPasses = await startBigTwoAutoPass(runtime, forced);
    try {
      await runtime.mutate(() => expect(manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]).success).toBe(true));
      expect(game().clock!.turn).toBeNull();
      const deadline = game().pendingAutoPass!.executeAt;
      await vi.advanceTimersByTimeAsync(deadline - Date.now());
      await runtime.idle();
      expect(forced).toHaveBeenCalledTimes(1);
      expect(timed).not.toHaveBeenCalled();
      expect(game().clock!.bankRemainingMs.W).toBe(20000);
      expect(game().log.filter((entry) => entry.type === 'pass' && entry.seat === 'W')).toHaveLength(1);
    } finally {
      stopTimers();
      stopPasses();
    }
  });

  it.each([0, 5000])('should sample %i ms after presentation without exposing an early pass', (delay) => {
    const random = vi.mocked(crypto.randomInt).mockReturnValue(delay);
    restoreHands(singleHands());
    const length = game().log.length;
    expect(manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)])).toEqual({ success: true });
    const state = game();
    expect(state).toMatchObject({ currentTurnSeat: 'W', lockedSeats: [], lastPlay: { seat: 'N' } });
    expect(state.log.slice(length)).toEqual([expect.objectContaining({ type: 'play', seat: 'N' })]);
    expect(state.pendingAutoPass?.executeAt).toBe(getPresentationEndsAt(state) + delay);
    expect(manager.getPlayerVisibleState(CODE, 'E')).not.toHaveProperty('pendingAutoPass');
    const pending = state.pendingAutoPass!;
    const before = structuredClone(state);
    vi.setSystemTime(pending.executeAt - 1);
    expect(manager.handlePendingAutoPass(CODE, state.id, pending.id).success).toBe(false);
    expect(game()).toEqual(before);
    manager.preparePendingAutoPasses();
    expect(random).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledWith(5001);
    automaticPass();
    expect(game().currentTurnSeat).toBe('S');
    expect(game().lockedSeats).toEqual(['W']);
    expect(game().log.at(-1)).toMatchObject({ type: 'pass', seat: 'W' });
    expect(game().pendingAutoPass?.executeAt).toBe(getPresentationEndsAt(game()) + delay);
  });

  it('should publish each pass separately before finally granting a free lead', () => {
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    automaticPass(); automaticPass(); automaticPass();
    expect(game()).toMatchObject({ currentTurnSeat: 'N', lastPlay: null, lockedSeats: [] });
    expect(game().pendingAutoPass).toBeUndefined();
    expect(game().log.slice(-5).map((entry) => entry.type)).toEqual(['play', 'pass', 'pass', 'pass', 'round_end']);
  });

  it('should allow a manual pass after presentation and invalidate its sampled job', () => {
    vi.mocked(crypto.randomInt).mockReturnValue(5000);
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    const old = game().pendingAutoPass!;
    vi.setSystemTime(getPresentationEndsAt(game()));
    expect(manager.handleBigTwoPass(CODE, 'W').success).toBe(true);
    vi.setSystemTime(old.executeAt);
    expect(manager.handlePendingAutoPass(CODE, game().id, old.id).success).toBe(false);
    expect(game().log.filter((entry) => entry.type === 'pass' && entry.seat === 'W')).toHaveLength(1);
  });

  it.each([
    [card('spades', 2)],
    [card('clubs', 9), card('diamonds', 9), card('hearts', 9), card('spades', 9), card('hearts', 3)],
    [card('hearts', 4), card('hearts', 5), card('hearts', 6), card('hearts', 7), card('hearts', 8)],
  ])('should wait for a legal response including bombs', (...cards) => {
    restoreHands({ ...singleHands(), N: [card('clubs', 7), card('clubs', 3)], W: cards });
    manager.handleBigTwoPlay(CODE, 'N', [card('clubs', 7)]);
    expect(game().currentTurnSeat).toBe('W');
    expect(game().pendingAutoPass).toBeUndefined();
  });

  it('should not schedule a free lead or a finished game', () => {
    restoreHands(singleHands());
    manager.preparePendingAutoPasses();
    expect(game().pendingAutoPass).toBeUndefined();
    restoreHands({ ...singleHands(), N: [card('spades', 2)] });
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    expect(game().phase).toBe('scoring');
    expect(game().pendingAutoPass).toBeUndefined();
  });

  it('should validate private persisted deadlines and reject invalid or playable pending seats', () => {
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    const saved = snapshot();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    const state = saved.games[0] as BigTwoGameState;
    const pending = state.pendingAutoPass!;
    for (const executeAt of [-1, Infinity, 0.5, getPresentationEndsAt(state) - 1]) {
      state.pendingAutoPass = { ...pending, executeAt };
      expect(isRuntimeSnapshot(saved)).toBe(false);
    }
    state.pendingAutoPass = { ...pending, seat: 'N' };
    expect(isRuntimeSnapshot(saved)).toBe(false);
    state.pendingAutoPass = pending;
    expect(isRuntimeSnapshot(saved)).toBe(true);
    delete state.pendingAutoPass;
    expect(isRuntimeSnapshot(saved)).toBe(true);
  });

  it('should restore a sampled deadline, commit before publishing, and cancel on shutdown', async () => {
    vi.mocked(crypto.randomInt).mockReturnValue(5000);
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    let saved = snapshot();
    const pending = game().pendingAutoPass!;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot> => structuredClone(saved),
      saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => { saved = structuredClone(state); }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    const publish = vi.fn(() => {
      expect((saved.games[0] as BigTwoGameState).lockedSeats).toEqual(['W']);
    });
    const stop = await startBigTwoAutoPass(runtime, publish);
    expect(game().pendingAutoPass).toEqual(pending);
    await vi.advanceTimersByTimeAsync(pending.executeAt - Date.now() - 1);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(repository.saveRuntime).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('should retry a failed commit without publishing early or sampling again', async () => {
    const random = vi.mocked(crypto.randomInt).mockReturnValue(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    let saved = snapshot();
    const pending = game().pendingAutoPass!;
    let reject = true;
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot> => structuredClone(saved),
      saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => {
        if (reject) { reject = false; throw new Error('disk unavailable'); }
        saved = structuredClone(state);
      }),
    };
    const runtime = await createRuntimeCoordinator(repository);
    const publish = vi.fn();
    const stop = await startBigTwoAutoPass(runtime, publish);
    await vi.advanceTimersByTimeAsync(pending.executeAt - Date.now());
    await runtime.idle();
    expect(game().pendingAutoPass).toEqual(pending);
    expect(publish).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(repository.saveRuntime).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(random).toHaveBeenCalledTimes(3);
    stop();
  });

  it('should restore an old short deadline and use readable timing on its next action', async () => {
    vi.mocked(crypto.randomInt).mockReturnValue(0);
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    const state = game();
    state.presentation = { ...state.presentation!, timingVersion: undefined };
    state.pendingAutoPass = { ...state.pendingAutoPass!, executeAt: state.presentation!.startedAt + 400 };
    let saved = snapshot();
    expect(isRuntimeSnapshot(saved)).toBe(true);
    const runtime = await createRuntimeCoordinator({
      loadRuntime: async () => structuredClone(saved),
      saveRuntime: async (next) => {
        expect(isRuntimeSnapshot(next)).toBe(true);
        saved = structuredClone(next);
      },
    });
    const publish = vi.fn();
    const stop = await startBigTwoAutoPass(runtime, publish);
    expect(game().pendingAutoPass?.executeAt).toBe(10400);
    await vi.advanceTimersByTimeAsync(400);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().presentation?.timingVersion).toBe(2);
    expect(getPresentationEndsAt(game())).toBe(11400);
    stop();
  });

  it('should durably sample a legacy pending turn once and reuse it after restarting', async () => {
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    delete game().pendingAutoPass;
    vi.mocked(crypto.randomInt).mockClear();
    let saved = snapshot();
    const repository = {
      loadRuntime: async (): Promise<RuntimeSnapshot> => structuredClone(saved),
      saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => { saved = structuredClone(state); }),
    };
    let runtime = await createRuntimeCoordinator(repository);
    let stop = await startBigTwoAutoPass(runtime, vi.fn());
    const pending = game().pendingAutoPass;
    expect(pending?.executeAt).toBe(getPresentationEndsAt(game()) + 1500);
    expect((saved.games[0] as BigTwoGameState).pendingAutoPass).toEqual(pending);
    expect(repository.saveRuntime).toHaveBeenCalledTimes(1);
    stop();
    runtime = await createRuntimeCoordinator(repository);
    stop = await startBigTwoAutoPass(runtime, vi.fn());
    expect(game().pendingAutoPass).toEqual(pending);
    expect(crypto.randomInt).toHaveBeenCalledTimes(1);
    expect(repository.saveRuntime).toHaveBeenCalledTimes(1);
    stop();
  });

  it('should cancel the old timer when a player manually passes first', async () => {
    vi.mocked(crypto.randomInt).mockReturnValue(5000);
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    const saved = snapshot();
    const runtime = await createRuntimeCoordinator({
      loadRuntime: async (): Promise<RuntimeSnapshot> => saved,
      saveRuntime: async (): Promise<void> => {},
    });
    const publish = vi.fn();
    const stop = await startBigTwoAutoPass(runtime, publish);
    await vi.advanceTimersByTimeAsync(getPresentationEndsAt(game()) - Date.now());
    await runtime.mutate(() => {
      expect(manager.handleBigTwoPass(CODE, 'W').success).toBe(true);
    });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(publish).not.toHaveBeenCalled();
    expect(game().lockedSeats).toEqual(['W']);
    expect(game().currentTurnSeat).toBe('S');
    stop();
  });

  it.each(['abort', 'replace'] as const)('should cancel a scheduled job after %s', async (action) => {
    restoreHands(singleHands());
    manager.handleBigTwoPlay(CODE, 'N', [card('spades', 2)]);
    const saved = snapshot();
    const repository = { loadRuntime: async (): Promise<RuntimeSnapshot> => saved,
      saveRuntime: vi.fn(async (): Promise<void> => {}) };
    const runtime = await createRuntimeCoordinator(repository);
    const publish = vi.fn();
    const stop = await startBigTwoAutoPass(runtime, publish);
    await runtime.mutate(() => {
      if (action === 'abort') manager.abortGame(CODE);
      else manager.startGame(CODE, 'redpoints', saved.games[0].players);
    });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).not.toHaveBeenCalled();
    stop();
  });
});
