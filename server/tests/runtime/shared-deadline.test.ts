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
/** Short 5 + 20 second clocks are raised to the 60-second arrangement minimum. */
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
    games.startGame(code, gameType, rooms.getSeatPlayers(code)!, { baseSeconds: 5, bankSeconds: 20 });
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
  /** Short 5 + 20 second clocks use the 15-second betting minimum. */
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

describe('shared deadline atomicity and lifecycle', () => {
  const stops: (() => void)[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    games.restoreGames([]);
    rooms.restoreRooms([]);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each(['chinesepoker', 'blackjack'] as const)('publishes %s decisions only after a deferred durable save', async (type) => {
    const { runtime, repository, saved } = await fixture(false, type);
    const originalSave = repository.saveRuntime.getMockImplementation()!;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const saveStarted = new Promise<void>((resolve) => { started = resolve; });
    repository.saveRuntime.mockImplementationOnce(async (snapshot) => {
      started();
      await gate;
      await originalSave(snapshot);
    });
    vi.spyOn(decisions, 'getBotAction').mockImplementation((visible) => visible.gameType === 'chinesepoker'
      ? { type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand) }
      : { type: 'blackjack-bet', amount: BJ_MIN_BET });
    const stored = structuredClone(saved());
    const publish = vi.fn(() => expect(saved()).toEqual(runtime.snapshot()));
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(type === 'chinesepoker' ? ARRANGE_MS : 15_000);
    await saveStarted;
    const inspect = vi.fn(() => runtime.snapshot());
    const read = runtime.inspect(inspect);
    expect(inspect).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(saved()).toEqual(stored);
    release();
    await runtime.idle();
    await expect(read).resolves.toEqual(saved());
    expect(publish).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it.each(['chinesepoker', 'blackjack'] as const)('rolls back all pending %s decisions on save failure and retries once', async (type) => {
    const { code, runtime, repository, game, blackjackGame, saved } = await fixture(true, type);
    await runtime.mutate(() => {
      const result = type === 'chinesepoker'
        ? games.handleChinesePokerArrange(code, 'N', cpGreedyArrangement(game().hands.N))
        : games.handleBlackjackBet(code, 'N', 50);
      expect(result.success).toBe(true);
    });
    const before = runtime.snapshot();
    const stored = structuredClone(saved());
    const choose = vi.spyOn(decisions, 'getBotAction').mockImplementation((visible) => {
      if (visible.gameType === 'chinesepoker') return {
        type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand),
      };
      return { type: 'blackjack-bet', amount: BJ_MIN_BET };
    });
    repository.saveRuntime.mockClear();
    repository.saveRuntime.mockRejectedValueOnce(new Error('disk unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn(() => expect(saved().games).toEqual(runtime.snapshot().games));
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(type === 'chinesepoker' ? ARRANGE_MS : 15_000);
    await runtime.idle();
    expect(runtime.snapshot()).toEqual(before);
    expect(saved()).toEqual(stored);
    expect(publish).not.toHaveBeenCalled();
    expect(choose).toHaveBeenCalledTimes(3);
    for (const [visible] of choose.mock.calls) {
      expect(visible).not.toHaveProperty('deck');
      if (visible.gameType === 'chinesepoker') expect(visible).not.toHaveProperty('hands');
      else expect(visible).not.toHaveProperty('hole');
    }
    await vi.advanceTimersByTimeAsync(999);
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await runtime.idle();
    expect(repository.saveRuntime).toHaveBeenCalledTimes(2);
    expect(choose).toHaveBeenCalledTimes(6);
    expect(publish).toHaveBeenCalledTimes(1);
    if (type === 'chinesepoker') {
      expect(game().arrangements.N).toEqual(before.games[0].gameType === 'chinesepoker' && before.games[0].arrangements.N);
      expect(SEATS.every((seat) => game().arrangements[seat] !== null)).toBe(true);
      expect(game().phase).toBe('scoring');
    } else {
      expect(blackjackGame().log.find((entry) => entry.type === 'deal')).toMatchObject({ bets: { N: 50, E: 10, S: 10, W: 10 } });
    }
  });

  it.each(['chinesepoker', 'blackjack'] as const)('rolls back earlier seats when the second %s strategy throws', async (type) => {
    const { code, runtime, repository, game } = await fixture(true, type);
    await runtime.mutate(() => {
      expect((type === 'chinesepoker'
        ? games.handleChinesePokerArrange(code, 'N', cpGreedyArrangement(game().hands.N))
        : games.handleBlackjackBet(code, 'N', 50)).success).toBe(true);
    });
    const before = runtime.snapshot();
    let calls = 0;
    vi.spyOn(decisions, 'getBotAction').mockImplementation((visible) => {
      calls++;
      if (calls === 2) throw new Error('strategy unavailable');
      return visible.gameType === 'chinesepoker'
        ? { type: 'chinesepoker-arrange', arrangement: cpGreedyArrangement(visible.myHand) }
        : { type: 'blackjack-bet', amount: BJ_MIN_BET };
    });
    repository.saveRuntime.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const publish = vi.fn();
    stops.push(startSharedDeadlines(runtime, publish));
    await vi.advanceTimersByTimeAsync(type === 'chinesepoker' ? ARRANGE_MS : 15_000);
    await runtime.idle();
    expect(calls).toBe(2);
    expect(runtime.snapshot()).toEqual(before);
    expect(repository.saveRuntime).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await runtime.idle();
    expect(calls).toBe(5);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it.each((['chinesepoker', 'blackjack'] as const).flatMap((type) =>
    (['manual', 'replacement', 'abort', 'stop'] as const).map((change) => ({ type, change }))))(
    'ignores an expired $type job queued before $change', async ({ type, change }) => {
      const { code, runtime, repository, game, blackjackGame } = await fixture(false, type);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const publish = vi.fn();
      const choose = vi.spyOn(decisions, 'getBotAction');
      const stop = startSharedDeadlines(runtime, publish);
      stops.push(stop);
      const prior = runtime.mutate(async () => {
        if (change !== 'manual') await gate;
        if (change === 'manual') {
          for (const seat of SEATS) {
            expect((type === 'chinesepoker'
              ? games.handleChinesePokerArrange(code, seat, cpGreedyArrangement(game().hands[seat]))
              : games.handleBlackjackBet(code, seat, BJ_MIN_BET)).success).toBe(true);
          }
          if (type === 'blackjack') {
            while (blackjackGame().phase === 'playing') {
              vi.setSystemTime(Math.max(Date.now(), getPresentationEndsAt(blackjackGame())));
              expect(games.handleBlackjackAction(code, blackjackGame().currentTurnSeat, 'stand').success).toBe(true);
            }
            expect(blackjackGame().phase).toBe('betting');
            expect(blackjackGame().hand).toBe(1);
          }
        } else if (change === 'replacement') {
          games.startGame(code, type, rooms.getSeatPlayers(code)!);
        } else if (change === 'abort') {
          games.abortGame(code);
          rooms.setRoomStatus(code, 'waiting');
        }
        if (change === 'manual') await gate;
      });
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(type === 'chinesepoker' ? ARRANGE_MS : 15_000);
      if (change === 'stop') stop();
      release();
      await prior;
      const saves = repository.saveRuntime.mock.calls.length;
      await runtime.idle();
      expect(repository.saveRuntime).toHaveBeenCalledTimes(saves);
      expect(choose).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      if (change === 'replacement' || change === 'stop') {
        if (type === 'chinesepoker') expect(game().phase).toBe('arranging');
        else expect(blackjackGame().phase).toBe('betting');
      }
  });
});
