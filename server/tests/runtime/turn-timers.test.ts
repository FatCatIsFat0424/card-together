import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { Card, GameType, PlayerInfo, Seat } from '@shared/types';
import { createDeck } from '../../src/engine/deck';
import * as games from '../../src/managers/game-manager';
import * as redpoints from '../../src/managers/games/redpoints-game';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import { applyAutomatedAction, MAX_AUTOMATED_FAILURES } from '../../src/runtime/automated-action';
import * as decisions from '../../src/bots/bot-decisions';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;

async function fixture(gameType: GameType = 'ninetynine') {
  let saved: RuntimeSnapshot | null = null;
  const repository = {
    loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
    saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => {
      expect(isRuntimeSnapshot(state)).toBe(true);
      saved = structuredClone(state);
    }),
  };
  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    code = rooms.createRoom(gameType, 'N');
    for (const seat of SEATS) {
      players.attachPlayer(seat, PLAYERS[seat]);
      players.setPlayerRoom(seat, code);
      rooms.joinRoom(code, seat);
      rooms.changeSeat(code, PLAYERS[seat], seat);
    }
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, gameType, PLAYERS);
  });
  return { code, runtime, repository, saved: () => saved!,
    game: () => games.getGameState(code)!,
    setSaved: (state: RuntimeSnapshot): void => { saved = structuredClone(state); } };
}

function multiChoiceDeck(): Card[] {
  const slots: (Card | null)[] = Array.from({ length: 52 }, () => null);
  slots[0] = { suit: 'spades', rank: 6 };
  slots[24] = { suit: 'hearts', rank: 2 };
  slots[25] = { suit: 'spades', rank: 2 };
  slots[26] = { suit: 'diamonds', rank: 13 };
  slots[27] = { suit: 'clubs', rank: 10 };
  slots[28] = { suit: 'clubs', rank: 8 };
  const rest = createDeck().filter((card) => !slots.some((slot) => slot?.suit === card.suit && slot.rank === card.rank));
  return slots.map((slot) => slot ?? rest.shift()!);
}

describe('durable turn clocks', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

  it.each<GameType>(['bridge', 'bigtwo', 'redpoints', 'ninetynine', 'sevens'])(
    'times out one filtered legal decision in %s and commits before publishing', async (type) => {
      const { code, runtime, game, saved } = await fixture(type);
      const before = structuredClone(game());
      const turn = before.clock!.turn!;
      const choose = vi.spyOn(decisions, 'getBotAction');
      const publish = vi.fn(() => expect(saved().games[0]).toEqual(game()));
      stops.push(await startTurnTimers(runtime, publish));
      await vi.advanceTimersByTimeAsync(24999);
      expect(publish).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await runtime.idle();
      expect(publish).toHaveBeenCalledTimes(1);
      expect(game().log.length).toBeGreaterThan(before.log.length);
      expect(game().clock!.bankRemainingMs[turn.seat]).toBe(0);
      expect(game().clock!.lastTimeout).toEqual({ seat: turn.seat, at: Date.now() });
      expect(game().players[turn.seat].isBot).not.toBe(true);
      expect(choose).toHaveBeenCalledTimes(1);
      expect(choose.mock.calls[0][0]).not.toHaveProperty('hands');
      expect(choose.mock.calls[0][0]).not.toHaveProperty('stock');
      expect(games.getPlayerVisibleState(code, turn.seat)?.clock?.serverNow).toBe(Date.now());
      await vi.advanceTimersByTimeAsync(1);
      expect(publish).toHaveBeenCalledTimes(1);
    },
  );

  it('charges only excess decision time, preserves other banks, and rejects expired manual actions', async () => {
    const { code, runtime, game } = await fixture();
    const first = game().clock!.turn!;
    await vi.advanceTimersByTimeAsync(7000);
    const action = decisions.getBotAction(games.getPlayerVisibleState(code, first.seat)!)!;
    await runtime.mutate(() => expect(applyAutomatedAction(code, first.seat, action).success).toBe(true));
    expect(game().clock!.bankRemainingMs[first.seat]).toBe(18000);
    for (const seat of SEATS.filter((seat) => seat !== first.seat)) {
      expect(game().clock!.bankRemainingMs[seat]).toBe(20000);
    }
    const turn = game().clock!.turn!;
    expect(turn.startsAt).toBe(getPresentationEndsAt(game()));
    expect(turn.deadline - turn.startsAt).toBe(25000);
    vi.setSystemTime(turn.deadline);
    const next = decisions.getBotAction(games.getPlayerVisibleState(code, turn.seat)!)!;
    if (next.type !== 'ninetynine-play') throw new Error('Expected 99 action');
    const before = structuredClone(game());
    expect(games.handleNinetyNinePlay(code, turn.seat, next.card, next.choice, next.target).success).toBe(false);
    expect(game()).toEqual(before);
  });

  it('shares Red Points base time across both decisions while excluding presentation', async () => {
    const { code, runtime, game } = await fixture('redpoints');
    await runtime.mutate(() => {
      redpoints.startGame(code, PLAYERS, multiChoiceDeck(), 'N');
      games.initializeClock(code);
    });
    vi.setSystemTime(13000);
    await runtime.mutate(() => expect(games.handleRedPointsPlay(code, 'N', { suit: 'spades', rank: 6 }).success).toBe(true));
    const flip = game().clock!.turn!;
    expect(flip).toMatchObject({ seat: 'N', baseRemainingMs: 2000, startsAt: 14900, deadline: 36900 });
    expect(game().clock!.bankRemainingMs.N).toBe(20000);
    vi.setSystemTime(flip.startsAt + 4000);
    await runtime.mutate(() => expect(games.handleRedPointsChooseFlip(code, 'N', { suit: 'hearts', rank: 2 }).success).toBe(true));
    expect(game().clock!.bankRemainingMs.N).toBe(18000);
    expect(game().clock!.turn).toMatchObject({ seat: 'W', baseRemainingMs: 5000 });
  });

  it('applies the first legal action after repeated timeout strategy failures', async () => {
    const { runtime, game, saved } = await fixture();
    const turn = game().clock!.turn!;
    const before = game().log.length;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const choose = vi.spyOn(decisions, 'getBotAction').mockReturnValue(null);
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish));
    await vi.advanceTimersByTimeAsync(turn.deadline - Date.now() + (MAX_AUTOMATED_FAILURES - 1) * 1000);
    await runtime.idle();
    expect(choose).toHaveBeenCalledTimes(MAX_AUTOMATED_FAILURES);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().log.length).toBeGreaterThan(before);
    expect(game().clock!.lastTimeout).toEqual({ seat: turn.seat, at: Date.now() });
    expect(saved().games[0]).toEqual(game());
  });

  it('rolls back a failed timeout save and retries without publishing uncommitted state', async () => {
    const { runtime, game, repository } = await fixture();
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish));
    const before = structuredClone(game());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    repository.saveRuntime.mockRejectedValueOnce(new Error('disk unavailable'));
    await vi.advanceTimersByTimeAsync(25000);
    await runtime.idle();
    expect(game()).toEqual(before);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().clock!.bankRemainingMs[before.clock!.turn!.seat]).toBe(0);
  });

  it('retains restart deadlines, handles only the pending step, and continues during disconnect', async () => {
    const { runtime, code, repository, game } = await fixture();
    const turn = structuredClone(game().clock!.turn!);
    await runtime.mutate(() => players.markDisconnected(turn.seat));
    vi.setSystemTime(turn.deadline + 100000);
    const restarted = await createRuntimeCoordinator(repository);
    const publish = vi.fn();
    stops.push(await startTurnTimers(restarted, publish));
    expect(game().clock!.turn).toEqual(turn);
    await vi.advanceTimersByTimeAsync(1);
    await restarted.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().clock!.turn!.deadline).toBeGreaterThan(Date.now());
    expect(game().roomCode).toBe(code);
    expect(game().players[turn.seat].isBot).not.toBe(true);
  });

  it('discards a timeout queued behind a manual action whose save is still pending', async () => {
    const { runtime, code, repository, game } = await fixture();
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish));
    await vi.advanceTimersByTimeAsync(24999);
    const turn = game().clock!.turn!;
    const action = decisions.getBotAction(games.getPlayerVisibleState(code, turn.seat)!)!;
    if (action.type !== 'ninetynine-play') throw new Error('Expected 99 action');
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const save = repository.saveRuntime.getMockImplementation()!;
    repository.saveRuntime.mockImplementationOnce(async (state) => { await hold; await save(state); });
    const manual = runtime.mutate(() => {
      expect(games.handleNinetyNinePlay(code, turn.seat, action.card, action.choice, action.target).success).toBe(true);
    });
    await Promise.resolve();
    const logLength = game().log.length;
    await vi.advanceTimersByTimeAsync(1);
    release();
    await manual;
    await runtime.idle();
    expect(game().log).toHaveLength(logLength);
    expect(game().clock!.lastTimeout).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });

  it('replenishes every bank after either kind of Bridge redeal', async () => {
    const { runtime, code, game } = await fixture('bridge');
    await runtime.mutate(() => {
      const current = game();
      if (current.gameType !== 'bridge') throw new Error('Expected Bridge');
      current.phase = 'redeal_pending';
      current.bidding = null;
      current.redealPendingSeat = 'N';
      delete current.clock;
      games.initializeClock(code);
    });
    await vi.advanceTimersByTimeAsync(7000);
    await runtime.mutate(() => expect(games.handleRedealResponse(code, 'N', true).success).toBe(true));
    expect(game().clock!.bankRemainingMs).toEqual({ N: 20000, E: 20000, S: 20000, W: 20000 });
    for (let count = 0; count < 4; count++) {
      const current = game();
      if (current.gameType !== 'bridge' || current.phase !== 'redeal_pending') break;
      await runtime.mutate(() => expect(games.handleRedealResponse(code, current.redealPendingSeat!, false).success).toBe(true));
    }
    for (let count = 0; count < 4; count++) {
      const current = game();
      if (current.gameType !== 'bridge' || current.phase !== 'bidding') throw new Error('Expected bidding');
      const seat = current.bidding!.currentBidderSeat;
      await vi.advanceTimersByTimeAsync(7000);
      await runtime.mutate(() => expect(games.handleBid(code, seat, { type: 'pass' }).success).toBe(true));
      if (count < 3) expect(game().clock!.bankRemainingMs[seat]).toBe(18000);
    }
    expect(game().clock!.bankRemainingMs).toEqual({ N: 20000, E: 20000, S: 20000, W: 20000 });
  });

  it('cancels expired work after a replacement and after shutdown', async () => {
    const { runtime, code, game } = await fixture();
    const publish = vi.fn();
    const stop = await startTurnTimers(runtime, publish);
    stops.push(stop);
    await vi.advanceTimersByTimeAsync(24000);
    await runtime.mutate(() => games.startGame(code, 'ninetynine', PLAYERS));
    const replacement = game().id;
    await vi.advanceTimersByTimeAsync(1000);
    expect(game().id).toBe(replacement);
    expect(publish).not.toHaveBeenCalled();
    stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(publish).not.toHaveBeenCalled();
  });

  it('durably upgrades legacy snapshots and validates timer data', async () => {
    const { repository, saved, setSaved, game } = await fixture();
    const legacy = structuredClone(saved());
    delete legacy.games[0].clock;
    legacy.rooms[0].info = { ...legacy.rooms[0].info, timeControl: undefined };
    setSaved(legacy);
    const restarted = await createRuntimeCoordinator(repository);
    stops.push(await startTurnTimers(restarted, vi.fn()));
    expect(saved().rooms[0].info.timeControl).toEqual({ baseSeconds: 5, bankSeconds: 20 });
    expect(saved().games[0].clock).toEqual(game().clock);
    expect(isRuntimeSnapshot(saved())).toBe(true);
    const invalid = structuredClone(saved());
    invalid.games[0].clock = { ...invalid.games[0].clock!, bankRemainingMs: { N: -1, E: 20000, S: 20000, W: 20000 } };
    expect(isRuntimeSnapshot(invalid)).toBe(false);
  });

  it('does not start a scheduler when the legacy upgrade cannot be committed', async () => {
    const { repository, saved, setSaved } = await fixture();
    const legacy = structuredClone(saved());
    delete legacy.games[0].clock;
    setSaved(legacy);
    const restarted = await createRuntimeCoordinator(repository);
    repository.saveRuntime.mockRejectedValueOnce(new Error('disk unavailable'));
    const publish = vi.fn();
    await expect(startTurnTimers(restarted, publish)).rejects.toThrow('disk unavailable');
    await vi.advanceTimersByTimeAsync(50000);
    expect(publish).not.toHaveBeenCalled();
    expect(games.exportGames()[0].clock).toBeUndefined();
  });
});
