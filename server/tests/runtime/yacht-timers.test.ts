import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSeat, PlayerInfo } from '@shared/types';
import type { YachtGameState } from '@shared/games/yacht/types';
import { yachtRoundSeconds } from '@shared/rules/yacht';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startBotTurns } from '../../src/runtime/bot-turns';
import { startSharedDeadlines } from '../../src/runtime/shared-deadline';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const SETTINGS = { baseSeconds: 40, bankSeconds: 10 };
const person = (seat: GameSeat, isBot = false): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, ...isBot ? { isBot } : {},
});

async function setup(mode: 'turns' | 'simultaneous', bots = false): Promise<{
  runtime: Awaited<ReturnType<typeof createRuntimeCoordinator>>; code: string; repository: {
    loadRuntime: () => Promise<RuntimeSnapshot | null>; saveRuntime: (snapshot: RuntimeSnapshot) => Promise<void> };
}> {
  let saved: RuntimeSnapshot | null = null;
  const repository = {
    loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
    saveRuntime: async (snapshot: RuntimeSnapshot): Promise<void> => {
      expect(isRuntimeSnapshot(snapshot)).toBe(true);
      saved = structuredClone(snapshot);
    },
  };
  const runtime = await createRuntimeCoordinator(repository);
  let code = '';
  await runtime.mutate(() => {
    code = rooms.createRoom('yacht', 'N');
    const host = person('N');
    players.attachPlayer('N', host);
    players.setPlayerRoom('N', code);
    expect(rooms.changeSeat(code, host, 'N').success).toBe(true);
    if (bots) {
      expect(rooms.fillBots(code, 'N').success).toBe(true);
    } else {
      const guest = person('E');
      players.attachPlayer('E', guest);
      players.setPlayerRoom('E', code);
      expect(rooms.joinRoom(code, 'E').success).toBe(true);
      expect(rooms.changeSeat(code, guest, 'E').success).toBe(true);
    }
    rooms.setRoomStatus(code, 'playing');
    expect(games.startGame(code, 'yacht', rooms.getSeatPlayers(code)!, SETTINGS, { yacht: { mode } })).toEqual({ success: true });
  });
  return { runtime, code, repository };
}

describe('Yacht Dice durable timers', () => {
  let stop: (() => void) | undefined;
  afterEach(() => {
    stop?.();
    stop = undefined;
    games.restoreGames([]);
    rooms.restoreRooms([]);
    players.restorePlayers([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('plays a whole timed-out turn once, and keeps the turn clock across a roll', async () => {
    vi.useFakeTimers({ now: 100_000 });
    const { runtime, code, repository } = await setup('turns');
    const game = (): YachtGameState => games.getGameState(code) as YachtGameState;
    const turn = game().clock!.turn!;
    expect(turn).toMatchObject({ seat: 'N', baseRemainingMs: 40_000 });
    expect(games.handleGameAction(code, 'N', { gameType: 'yacht', action: { type: 'roll' } }).success).toBe(true);
    // A roll is part of the same turn: its deadline moves only by the time the roll took.
    expect(game().clock!.turn!.deadline).toBe(turn.deadline);

    games.restoreGames([]);
    const resumed = await createRuntimeCoordinator(repository);
    const publish = vi.fn();
    stop = await startTurnTimers(resumed, publish);
    await vi.advanceTimersByTimeAsync(turn.deadline - Date.now() - 1);
    expect(publish).not.toHaveBeenCalled();
    expect(game().log).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await resumed.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().log).toHaveLength(1);
    expect(game().log[0]).toMatchObject({ seat: 'N', rolls: 1 });
    expect(game().currentTurnSeat).toBe('E');
    expect(game().clock?.lastTimeout?.seat).toBe('N');
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(1);
    void runtime;
  });

  it('completes every unfinished turn at the shared round deadline, then opens the next round', async () => {
    vi.useFakeTimers({ now: 200_000 });
    const { runtime, code } = await setup('simultaneous');
    const game = (): YachtGameState => games.getGameState(code) as YachtGameState;
    const deadline = game().roundDeadline!;
    expect(deadline).toBe(Date.now() + yachtRoundSeconds(SETTINGS.baseSeconds) * 1000);
    expect(games.handleGameAction(code, 'N', { gameType: 'yacht', action: { type: 'roll' } }).success).toBe(true);
    const publish = vi.fn();
    stop = startSharedDeadlines(runtime, publish);
    await vi.advanceTimersByTimeAsync(deadline - Date.now() - 1);
    expect(game().log).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().round).toBe(2);
    expect(game().log.map((entry) => [entry.round, entry.seat, entry.rolls])).toEqual([[1, 'N', 1], [1, 'E', 1]]);
    expect(game().roundDeadline).toBe(deadline + yachtRoundSeconds(SETTINGS.baseSeconds) * 1000);
  });

  it('lets bots roll and score on their own in both modes', async () => {
    for (const mode of ['turns', 'simultaneous'] as const) {
      vi.useFakeTimers({ now: 300_000 });
      const { runtime, code } = await setup(mode, true);
      const game = (): YachtGameState => games.getGameState(code) as YachtGameState;
      // The human host plays on auto-play, so every seat is automated.
      await runtime.mutate(() => expect(games.setAutoPlay(code, 'N', true).success).toBe(true));
      stop = startBotTurns(runtime, vi.fn());
      await vi.advanceTimersByTimeAsync(120_000);
      await runtime.idle();
      expect(game().log.length).toBeGreaterThan(2);
      expect(game().log.every((entry) => entry.rolls >= 1 && entry.rolls <= 3)).toBe(true);
      stop();
      stop = undefined;
      games.restoreGames([]);
      rooms.restoreRooms([]);
      players.restorePlayers([]);
      vi.useRealTimers();
    }
  });
});
