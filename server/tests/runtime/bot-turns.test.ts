import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { PlayerInfo } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { BOT_ACTION_DELAY_MS, startBotTurns } from '../../src/runtime/bot-turns';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const human: PlayerInfo = {
  id: 'human', username: 'human', nickname: 'Human', color: '#123456', avatar: 'cat', avatarImage: null,
};

async function fixture() {
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
    players.attachPlayer('socket', human);
    code = rooms.createRoom('redpoints', human.id);
    players.setPlayerRoom(human.id, code);
    rooms.changeSeat(code, human, 'N');
    rooms.fillBots(code, human.id);
    rooms.setReady(code, human.id, true);
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, 'redpoints', rooms.getSeatPlayers(code)!);
    const game = games.getGameState(code)!;
    if (game.gameType === 'redpoints') game.currentTurnSeat = 'S';
  });
  repository.saveRuntime.mockClear();
  return { code, runtime, repository, saved: () => saved! };
}

describe('server bot turn scheduling', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('commits before publishing and waits for presentations before another action', async () => {
    const { code, runtime, repository, saved } = await fixture();
    const publish = vi.fn(() => {
      expect(saved().games[0].log).toEqual(games.getGameState(code)!.log);
    });
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS - 1);
    expect(repository.saveRuntime).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    const deadline = getPresentationEndsAt(games.getGameState(code)!);
    expect(deadline).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(deadline - Date.now() + BOT_ACTION_DELAY_MS - 1);
    expect(publish).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('rolls back a failed save and retries without publishing the rejected action', async () => {
    const { code, runtime, repository, saved } = await fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = structuredClone(saved());
    repository.saveRuntime.mockRejectedValueOnce(new Error('disk unavailable'));
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    await runtime.idle();
    expect(games.getGameState(code)).toEqual(before.games[0]);
    expect(publish).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('reconstructs bot turns after restart and cancels them after abort or shutdown', async () => {
    const { code, runtime, repository } = await fixture();
    const publish = vi.fn();
    const stop = startBotTurns(runtime, publish);
    stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).not.toHaveBeenCalled();
    const restarted = await createRuntimeCoordinator(repository);
    stops.push(startBotTurns(restarted, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    expect(publish).toHaveBeenCalledTimes(1);
    await restarted.mutate(() => {
      games.abortGame(code);
      rooms.setRoomStatus(code, 'waiting');
      rooms.resetAllReady(code);
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does not take a human turn', async () => {
    const { code, runtime } = await fixture();
    await runtime.mutate(() => {
      const game = games.getGameState(code)!;
      if (game.gameType === 'redpoints') game.currentTurnSeat = 'N';
    });
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).not.toHaveBeenCalled();
  });
});
