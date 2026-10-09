import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import type { ChinesePokerGameState, PlayerInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import * as decisions from '../../src/bots/bot-decisions';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { BOT_ACTION_DELAY_MS, startBotTurns } from '../../src/runtime/bot-turns';
import { startChinesePokerDeadlines } from '../../src/runtime/chinesepoker-deadline';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;
/** Default 5 + 20 second clocks are raised to the 60-second arrangement minimum. */
const ARRANGE_MS = 60_000;

async function fixture(withBots = false) {
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
    code = rooms.createRoom('chinesepoker', 'N');
    const humans = withBots ? ['N'] as const : SEATS;
    for (const seat of humans) {
      players.attachPlayer(seat, PLAYERS[seat]);
      players.setPlayerRoom(seat, code);
      rooms.joinRoom(code, seat);
      rooms.changeSeat(code, PLAYERS[seat], seat);
    }
    if (withBots) rooms.fillBots(code, 'N');
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, 'chinesepoker', rooms.getSeatPlayers(code)!);
  });
  repository.saveRuntime.mockClear();
  const game = (): ChinesePokerGameState => {
    const state = games.getGameState(code);
    if (state?.gameType !== 'chinesepoker') throw new Error('Expected a Chinese Poker game');
    return state;
  };
  return { code, runtime, repository, game, saved: () => saved! };
}

describe('Chinese Poker simultaneous arrangement', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('publishes no single-seat turn and uses the shared arrangement deadline', async () => {
    const { game } = await fixture();
    expect(game().clock?.turn).toBeNull();
    expect(game().arrangeDeadline).toBe(Date.now() + ARRANGE_MS);
  });

  it('arranges every missing seat at the deadline and commits before publishing', async () => {
    const { code, runtime, game, saved } = await fixture();
    await runtime.mutate(() => {
      expect(games.handleChinesePokerArrange(code, 'E', cpGreedyArrangement(game().hands.E))).toEqual({ success: true });
    });
    const choose = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn(() => expect(saved().games[0]).toEqual(game()));
    stops.push(startChinesePokerDeadlines(runtime, publish));
    stops.push(await startTurnTimers(runtime, vi.fn()));
    await vi.advanceTimersByTimeAsync(ARRANGE_MS - 1);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().phase).toBe('scoring');
    expect(game().autoArranged).toEqual(['N', 'S', 'W']);
    expect(choose).toHaveBeenCalledTimes(3);
    for (const [visible] of choose.mock.calls) {
      expect(visible).not.toHaveProperty('hands');
      expect(visible).not.toHaveProperty('arrangements');
    }
  });

  it('rejects manual arrangements after the deadline', async () => {
    const { code, game } = await fixture();
    vi.setSystemTime(Date.now() + ARRANGE_MS);
    expect(games.handleChinesePokerArrange(code, 'N', cpGreedyArrangement(game().hands.N)).success).toBe(false);
    expect(game().arrangements.N).toBeNull();
  });

  it('resumes an overdue deadline after a restart', async () => {
    const { runtime, game, saved } = await fixture();
    await runtime.mutate(() => { game().arrangeDeadline = Date.now() + 1000; });
    const restored = saved();
    games.restoreGames([]);
    games.restoreGames(restored.games);
    vi.setSystemTime(Date.now() + 5000);
    const publish = vi.fn();
    stops.push(startChinesePokerDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(game().phase).toBe('scoring');
  });

  it('lets bots arrange one at a time while the human is still arranging', async () => {
    const { code, runtime, game } = await fixture(true);
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS * 3);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(3);
    expect(SEATS.filter((seat) => game().arrangements[seat] !== null)).toEqual(['E', 'S', 'W']);
    expect(game().autoArranged).toEqual([]);
    expect(game().phase).toBe('arranging');
    await runtime.mutate(() => {
      expect(games.handleChinesePokerArrange(code, 'N', cpGreedyArrangement(game().hands.N))).toEqual({ success: true });
    });
    expect(game().phase).toBe('scoring');
    expect(game().result?.scores).toBeDefined();
  });
});
