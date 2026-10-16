import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPresentationEndsAt } from '@shared/game-presentation';
import type { BotDifficulty, PlayerInfo } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import * as chat from '../../src/managers/chat-manager';
import * as decisions from '../../src/bots/bot-decisions';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import { BOT_ACTION_DELAY_MS, startBotTurns } from '../../src/runtime/bot-turns';
import { AUTOMATED_ABORT_MESSAGE, MAX_AUTOMATED_FAILURES } from '../../src/runtime/automated-action';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const human: PlayerInfo = {
  id: 'human', username: 'human', nickname: 'Human', color: '#123456', avatar: 'cat', avatarImage: null,
};

async function fixture(difficulty: BotDifficulty = 'hard') {
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
    rooms.setBotDifficulty(code, human.id, 'S', difficulty);
    rooms.setReady(code, human.id, true);
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, 'redpoints', rooms.getSeatPlayers(code)!);
    const game = games.getGameState(code)!;
    if (game.gameType === 'redpoints') game.currentTurnSeat = 'S';
    delete game.clock;
    games.initializeClock(code);
  });
  repository.saveRuntime.mockClear();
  return { code, runtime, repository, saved: () => saved! };
}

describe('server bot turn scheduling', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

  it('persists human auto-play, uses a private bot view, and cancels the scheduled move when disabled', async () => {
    const { code, runtime, saved } = await fixture();
    await runtime.mutate(() => {
      const game = games.getGameState(code)!;
      if (game.gameType === 'redpoints') game.currentTurnSeat = 'N';
      delete game.clock;
      games.initializeClock(code);
      expect(games.setAutoPlay(code, 'N', true)).toEqual({ success: true });
    });
    expect(saved().games[0].autoPlaySeats).toEqual(['N']);
    games.restoreGames(structuredClone(saved().games));
    expect(games.getPlayerVisibleState(code, 'N')?.autoPlay).toBe(true);
    expect(games.getPlayerVisibleState(code, 'E')?.autoPlay).toBe(false);
    const view = games.getPlayerVisibleState(code, 'N')!;
    if (view.gameType !== 'redpoints') throw new Error('Expected Red Points');
    expect(games.handleRedPointsPlay(code, 'N', view.myHand[0]).success).toBe(false);
    const strategy = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await runtime.mutate(() => { games.setAutoPlay(code, 'N', false); });
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    expect(strategy).not.toHaveBeenCalled();
    await runtime.mutate(() => { games.setAutoPlay(code, 'N', true); });
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    await runtime.idle();
    expect(strategy).toHaveBeenCalledTimes(1);
    expect(strategy.mock.calls[0][0]).toMatchObject({ mySeat: 'N', autoPlay: true });
    expect(strategy.mock.calls[0][0]).not.toHaveProperty('observedHands');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(games.getGameState(code)?.players.N?.isBot).not.toBe(true);
    expect(games.getGameState(code)?.autoPlaySeats).toEqual(['N']);
  });

  it('rolls back a failed auto-play toggle without scheduling or publishing a move', async () => {
    const { code, runtime, repository } = await fixture();
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    repository.saveRuntime.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(runtime.mutate(() => { games.setAutoPlay(code, 'N', true); }))
      .rejects.toThrow('disk unavailable');
    expect(games.getPlayerVisibleState(code, 'N')?.autoPlay).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(games.setAutoPlay(code, 'E', true).success).toBe(false);
    expect(games.setAutoPlay(code, 'P5', true).success).toBe(false);
  });

  it('accepts legacy snapshots and rejects malformed or bot automation seats', async () => {
    const { saved } = await fixture();
    expect(isRuntimeSnapshot(saved())).toBe(true);
    for (const invalid of [['N', 'N'], ['P9'], ['S'], 'N', [null]]) {
      const snapshot = structuredClone(saved());
      Object.assign(snapshot.games[0], { autoPlaySeats: invalid });
      expect(isRuntimeSnapshot(snapshot)).toBe(false);
    }
  });

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

  it.each(['easy', 'hard'] as const)('uses the saved %s strategy after restart', async (difficulty) => {
    const { repository } = await fixture(difficulty);
    const runtime = await createRuntimeCoordinator(repository);
    const strategy = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    await runtime.idle();
    expect(strategy).toHaveBeenCalledWith(expect.objectContaining({ mySeat: 'S' }), Math.random, difficulty);
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

  it('keeps bot turns exclusively with the bot scheduler even after their clock expires', async () => {
    const { runtime } = await fixture();
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish));
    await vi.advanceTimersByTimeAsync(30000);
    expect(publish).not.toHaveBeenCalled();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does not take a human turn', async () => {
    const { code, runtime } = await fixture();
    await runtime.mutate(() => {
      const game = games.getGameState(code)!;
      if (game.gameType === 'redpoints') game.currentTurnSeat = 'N';
      delete game.clock;
      games.initializeClock(code);
    });
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).not.toHaveBeenCalled();
  });

  it('falls back to the first legal action after repeated strategy failures', async () => {
    const { code, runtime } = await fixture();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const strategy = vi.spyOn(decisions, 'getBotAction').mockImplementation(() => {
      throw new Error('strategy bug');
    });
    const before = games.getGameState(code)!.log.length;
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS + (MAX_AUTOMATED_FAILURES - 1) * 1000);
    await runtime.idle();
    expect(strategy).toHaveBeenCalledTimes(MAX_AUTOMATED_FAILURES);
    expect(error).toHaveBeenCalledTimes(MAX_AUTOMATED_FAILURES);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await runtime.idle();
    expect(strategy).toHaveBeenCalledTimes(MAX_AUTOMATED_FAILURES);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(games.getGameState(code)!.log.length).toBeGreaterThan(before);
  });

  it('aborts with a system message when no automated action can be applied', async () => {
    const { code, runtime, saved } = await fixture();
    await runtime.mutate(() => chat.initRoomChat(code));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(games, 'handleRedPointsPlay').mockReturnValue({ success: false, reason: 'rejected' });
    vi.spyOn(games, 'handleRedPointsChooseFlip').mockReturnValue({ success: false, reason: 'rejected' });
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS + MAX_AUTOMATED_FAILURES * 1000);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(games.getGameState(code)).toBeNull();
    expect(rooms.getRoomInfo(code)?.status).toBe('waiting');
    expect(saved().games).toEqual([]);
    expect(chat.getChatHistory(code).at(-1)).toMatchObject({ system: true, content: AUTOMATED_ABORT_MESSAGE });
    await vi.advanceTimersByTimeAsync(10000);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
