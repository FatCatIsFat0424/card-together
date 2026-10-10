import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpGreedyArrangement } from '@shared/rules/chinesepoker-arrange';
import type { BlackjackGameState, ChinesePokerGameState, GameType, PlayerInfo, Seat } from '@shared/types';
import { getPresentationEndsAt } from '@shared/game-presentation';
import { BJ_MIN_BET } from '@shared/rules/blackjack';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import * as decisions from '../../src/bots/bot-decisions';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { BOT_ACTION_DELAY_MS, startBotTurns } from '../../src/runtime/bot-turns';
import { startSharedDeadlines } from '../../src/runtime/shared-deadline';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';
import { isRuntimeSnapshot } from '../../src/runtime/validate';

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null,
}])) as Record<Seat, PlayerInfo>;
/** Default 5 + 20 second clocks are raised to the 60-second arrangement minimum. */
const ARRANGE_MS = 60_000;

async function fixture(withBots = false, gameType: GameType = 'chinesepoker') {
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
    const humans = withBots ? ['N'] as const : SEATS;
    for (const seat of humans) {
      players.attachPlayer(seat, PLAYERS[seat]);
      players.setPlayerRoom(seat, code);
      rooms.joinRoom(code, seat);
      rooms.changeSeat(code, PLAYERS[seat], seat);
    }
    if (withBots) rooms.fillBots(code, 'N');
    rooms.setRoomStatus(code, 'playing');
    games.startGame(code, gameType, rooms.getSeatPlayers(code)!);
  });
  repository.saveRuntime.mockClear();
  const game = (): ChinesePokerGameState => {
    const state = games.getGameState(code);
    if (state?.gameType !== 'chinesepoker') throw new Error('Expected a Chinese Poker game');
    return state;
  };
  const blackjackGame = (): BlackjackGameState => {
    const state = games.getGameState(code);
    if (state?.gameType !== 'blackjack') throw new Error('Expected a Blackjack game');
    return state;
  };
  return { code, runtime, repository, game, blackjackGame, saved: () => saved! };
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
    stops.push(startSharedDeadlines(runtime, publish));
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
    stops.push(startSharedDeadlines(runtime, publish));
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

describe('Blackjack simultaneous betting', () => {
  const stops: (() => void)[] = [];
  /** Default 5 + 20 second clocks use the 15-second betting minimum. */
  const BET_MS = 15_000;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stakes the minimum for humans who miss the window and deals in the same commit', async () => {
    const { code, runtime, blackjackGame, saved } = await fixture(false, 'blackjack');
    await runtime.mutate(() => { expect(games.handleBlackjackBet(code, 'E', 120)).toEqual({ success: true }); });
    const publish = vi.fn(() => expect(saved().games[0]).toEqual(blackjackGame()));
    stops.push(startSharedDeadlines(runtime, publish));
    stops.push(await startTurnTimers(runtime, vi.fn()));
    await vi.advanceTimersByTimeAsync(BET_MS - 1);
    expect(publish).not.toHaveBeenCalled();
    expect(games.handleBlackjackBet(code, 'N', 50).success).toBe(true);
    await runtime.idle();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(publish).toHaveBeenCalledTimes(1);
    const deal = blackjackGame().log.find((entry) => entry.type === 'deal');
    expect(deal).toMatchObject({ bets: { N: 50, E: 120, S: BJ_MIN_BET, W: BJ_MIN_BET } });
    expect(blackjackGame().log.filter((entry) => entry.type === 'bet').map((entry) => entry.type === 'bet' && entry.auto))
      .toEqual([false, false, true, true]);
  });

  it('rejects manual bets after the deadline and schedules each new betting window', async () => {
    const { code, runtime, blackjackGame } = await fixture(false, 'blackjack');
    vi.setSystemTime(Date.now() + BET_MS);
    expect(games.handleBlackjackBet(code, 'N', 50).success).toBe(false);
    stops.push(startSharedDeadlines(runtime, vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    await runtime.idle();
    const state = blackjackGame();
    if (state.phase === 'playing') {
      await runtime.mutate(() => {
        while (state.phase === 'playing') {
          vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(state)));
          expect(games.handleBlackjackAction(code, state.currentTurnSeat, 'stand').success).toBe(true);
        }
      });
    }
    expect(state.phase).toBe('betting');
    expect(state.betDeadline).toBe(getPresentationEndsAt(state) + BET_MS);
    await vi.advanceTimersByTimeAsync(state.betDeadline! - Date.now());
    await runtime.idle();
    expect(state.hand).toBe(2);
  });

  it('lets bots bet one at a time while the human is still choosing', async () => {
    const { code, runtime, blackjackGame } = await fixture(true, 'blackjack');
    stops.push(startBotTurns(runtime, vi.fn()));
    await vi.advanceTimersByTimeAsync(BOT_ACTION_DELAY_MS * 3);
    await runtime.idle();
    expect(blackjackGame().phase).toBe('betting');
    expect(SEATS.filter((seat) => blackjackGame().bets[seat] !== null)).toEqual(['E', 'S', 'W']);
    await runtime.mutate(() => { expect(games.handleBlackjackBet(code, 'N', 50)).toEqual({ success: true }); });
    expect(blackjackGame().hand).toBe(1);
  });
});
