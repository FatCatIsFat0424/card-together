import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerInfo, Seat } from '@shared/types';
import * as games from '../../src/managers/game-manager';
import * as rooms from '../../src/managers/room-manager';
import * as players from '../../src/managers/player-manager';
import * as decisions from '../../src/bots/bot-decisions';
import * as registry from '../../src/bots/bot-registry';
import { redPointsFirstLegalAction } from '../../src/bots/fallback-actions';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { searchStrategy } from '../../src/bots/search/search-types';
import type { SearchOutcome, SearchRunner, SearchTask } from '../../src/bots/search/search-types';
import { createRuntimeCoordinator } from '../../src/runtime/coordinator';
import { startBotTurns } from '../../src/runtime/bot-turns';
import { startTurnTimers } from '../../src/runtime/turn-timers';
import type { RuntimeSnapshot } from '../../src/runtime/types';

// Real timers: the pool talks to real worker threads, so the turn's 650 ms thinking delay is real too.
const fixtureModule = new URL('../fixtures/search-strategies.ts', import.meta.url);
const human: PlayerInfo = {
  id: 'human', username: 'human', nickname: 'Human', color: '#123456', avatar: 'cat', avatarImage: null,
};

async function fixture(turnSeat: Seat = 'S') {
  let saved: RuntimeSnapshot | null = null;
  const repository = {
    loadRuntime: async (): Promise<RuntimeSnapshot | null> => structuredClone(saved),
    saveRuntime: vi.fn(async (state: RuntimeSnapshot): Promise<void> => { saved = structuredClone(state); }),
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
    if (game.gameType === 'redpoints') game.currentTurnSeat = turnSeat;
    delete game.clock;
    delete game.presentation;
    // A one-second clock lets the human's turn expire in real time.
    games.initializeClock(code, { baseSeconds: 1, bankSeconds: 0 });
  });
  const state = (): { log: number } => ({ log: games.getGameState(code)!.log.length });
  return { code, runtime, state };
}

/** Declares the search for Red Points only; every other registry lookup is untouched. */
function declareSearch(exportName: string, budgetMs = 1_000, maxDepth?: number): void {
  const real = registry.gameBot;
  vi.spyOn(registry, 'gameBot').mockImplementation(((gameType: Parameters<typeof real>[0]) => {
    const bot = real(gameType);
    return gameType === 'redpoints'
      ? { ...bot, search: { strategy: searchStrategy<'redpoints'>(fixtureModule, exportName), budgetMs, maxDepth } } : bot;
  }) as typeof real);
}

describe('search bots in the turn scheduler', () => {
  const stops: (() => void)[] = [];
  const pools: SearchPool[] = [];
  function openPool(options: Partial<Parameters<typeof createSearchPool>[0]> = {}): SearchPool {
    const pool = createSearchPool({ workers: 1, memoryMb: 128, queueLimit: 4, ...options });
    pools.push(pool);
    return pool;
  }
  afterEach(async () => {
    stops.splice(0).forEach((stop) => stop());
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
    vi.restoreAllMocks();
  });

  it('applies the worker result through the normal commit and publish flow', async () => {
    declareSearch('redPointsSearch');
    const { code, runtime, state } = await fixture();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const pool = openPool();
    const publish = vi.fn();
    const before = state().log;
    stops.push(startBotTurns(runtime, publish, pool));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    stops.splice(0).forEach((stop) => stop());
    expect(state().log).toBeGreaterThan(before);
    expect(games.getGameState(code)!.log.at(-1)).toMatchObject({ seat: 'S' });
    expect(sync).not.toHaveBeenCalled();
    expect(pool.stats()).toMatchObject({ completed: 1, timeouts: 0, crashes: 0 });
  });

  it('falls back to the synchronous strategy when the search overruns its budget', async () => {
    declareSearch('spinSearch', 100);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runtime, code } = await fixture();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const pool = openPool({ graceMs: 50 });
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish, pool));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    stops.splice(0).forEach((stop) => stop());
    expect(pool.stats().timeouts).toBe(1);
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mySeat: 'S' }));
    expect(games.getGameState(code)!.log.at(-1)).toMatchObject({ seat: 'S' });
  });

  it('falls back after a worker crash and keeps serving later turns', async () => {
    declareSearch('crashSearch');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime } = await fixture();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const pool = openPool();
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish, pool));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    stops.splice(0).forEach((stop) => stop());
    expect(pool.stats()).toMatchObject({ crashes: 1, alive: 0 });
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mySeat: 'S' }));
    await expect(pool.run({ strategy: searchStrategy(fixtureModule, 'echoSearch'), visible: {}, budgetMs: 500, seed: 1 }))
      .resolves.toMatchObject({ status: 'ok' });
  });

  it('decides synchronously without a pool', async () => {
    declareSearch('spinSearch');
    const { runtime } = await fixture();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    stops.push(startBotTurns(runtime, publish));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    stops.splice(0).forEach((stop) => stop());
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mySeat: 'S' }));
  });

  it('drops a result that arrives after the turn moved on', async () => {
    declareSearch('redPointsSearch');
    const { code, runtime, state } = await fixture();
    let finish: (outcome: SearchOutcome) => void = () => {};
    let task: SearchTask | undefined;
    // A runner that ignores cancellation, so the runtime's own recheck is what protects the game.
    const runner: SearchRunner = {
      run: (request) => new Promise<SearchOutcome>((resolve) => { task = request; finish = resolve; }),
    };
    const sync = vi.spyOn(decisions, 'getBotAction');
    stops.push(startBotTurns(runtime, vi.fn(), runner));
    await vi.waitFor(() => expect(task).toBeDefined(), { timeout: 5_000 });
    expect(task!.visible).toMatchObject({ mySeat: 'S' });
    expect(task).toMatchObject({ budgetMs: 1_000 });
    // The state version moves on without a commit notification and the seat is unchanged, so the move
    // is still legal: only the recheck before applying can tell that it answers an outdated view.
    const game = games.getGameState(code)!;
    (game.log as unknown[]).push(structuredClone(game.log[0]));
    const logAfterChange = state().log;
    sync.mockClear();
    const stale = redPointsFirstLegalAction(task!.visible as Parameters<typeof redPointsFirstLegalAction>[0]);
    expect(stale).not.toBeNull();
    finish({ status: 'ok', action: stale, elapsedMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.idle();
    expect(state().log).toBe(logAfterChange);
    expect(sync.mock.calls.every(([visible]) => (visible as { mySeat: string }).mySeat !== 'S')).toBe(true);
  });

  it('cancels the search when the turn changes and seeds it with an unsigned integer', async () => {
    declareSearch('redPointsSearch');
    const { code, runtime } = await fixture();
    const requests: { task: SearchTask; signal?: AbortSignal }[] = [];
    const runner: SearchRunner = {
      run: (task, signal) => new Promise<SearchOutcome>((resolve) => {
        requests.push({ task, signal });
        signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }));
      }),
    };
    stops.push(startBotTurns(runtime, vi.fn(), runner));
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 5_000 });
    await runtime.mutate(() => { games.abortGame(code); });
    expect(requests[0].signal?.aborted).toBe(true);
    expect(Number.isInteger(requests[0].task.seed) && requests[0].task.seed >= 0).toBe(true);
  });
});

describe('search for expired human turns', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.restoreAllMocks();
  });

  interface ControlledRequest {
    readonly task: SearchTask;
    readonly signal?: AbortSignal;
    readonly finish: (outcome: SearchOutcome) => void;
  }

  /** A runner whose answer the test controls, recording each request and its cancellation signal. */
  function controlledRunner(): { runner: SearchRunner; requests: ControlledRequest[] } {
    const requests: ControlledRequest[] = [];
    const runner: SearchRunner = {
      run: (task, signal) => new Promise<SearchOutcome>((resolve) => {
        requests.push({ task, signal, finish: resolve });
        signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }));
      }),
    };
    return { runner, requests };
  }

  type RedPointsView = Parameters<typeof redPointsFirstLegalAction>[0];

  it('applies the pool result after the deadline through the normal commit and publish flow', async () => {
    declareSearch('redPointsSearch');
    const { code, runtime } = await fixture('N');
    const { runner, requests } = controlledRunner();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    const deadline = games.getGameState(code)!.clock!.turn!.deadline;
    stops.push(await startTurnTimers(runtime, publish, runner));
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 5_000 });
    expect(Date.now()).toBeGreaterThanOrEqual(deadline);
    expect(requests[0].task.visible).toMatchObject({ mySeat: 'N' });
    expect(requests[0].task.visible).not.toHaveProperty('hands');
    // Nothing is decided or published while the search runs.
    expect(publish).not.toHaveBeenCalled();
    const before = games.getGameState(code)!.log.length;
    const action = redPointsFirstLegalAction(requests[0].task.visible as RedPointsView);
    requests[0].finish({ status: 'ok', action, elapsedMs: 5 });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    const game = games.getGameState(code)!;
    expect(game.log.length).toBeGreaterThan(before);
    expect(game.log.at(-1)).toMatchObject({ seat: 'N' });
    expect(game.clock!.lastTimeout).toMatchObject({ seat: 'N' });
    expect(sync).not.toHaveBeenCalled();
  });

  it('uses the synchronous strategy when the search fails', async () => {
    declareSearch('redPointsSearch');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { code, runtime } = await fixture('N');
    const { runner, requests } = controlledRunner();
    const sync = vi.spyOn(decisions, 'getBotAction');
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish, runner));
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 5_000 });
    requests[0].finish({ status: 'crashed', reason: 'worker exited' });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ mySeat: 'N' }));
    expect(games.getGameState(code)!.log.at(-1)).toMatchObject({ seat: 'N' });
    expect(games.getGameState(code)!.clock!.lastTimeout).toMatchObject({ seat: 'N' });
  });

  it('cancels the search and drops its result when the turn is gone', async () => {
    declareSearch('redPointsSearch');
    const { code, runtime } = await fixture('N');
    const { runner, requests } = controlledRunner();
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish, runner));
    await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 5_000 });
    const visible = requests[0].task.visible as RedPointsView;
    await runtime.mutate(() => { games.abortGame(code); });
    expect(requests[0].signal?.aborted).toBe(true);
    requests[0].finish({ status: 'ok', action: redPointsFirstLegalAction(visible), elapsedMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await runtime.idle();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not search when the game rule decides the timeout without the bot', async () => {
    const real = registry.gameBot;
    vi.spyOn(registry, 'gameBot').mockImplementation(((gameType: Parameters<typeof real>[0]) => {
      const bot = real(gameType);
      return gameType === 'redpoints' ? {
        ...bot,
        search: { strategy: searchStrategy<'redpoints'>(fixtureModule, 'redPointsSearch'), budgetMs: 1_000 },
        turnTimeout: redPointsFirstLegalAction,
      } : bot;
    }) as typeof real);
    const { code, runtime } = await fixture('N');
    const { runner, requests } = controlledRunner();
    const publish = vi.fn();
    stops.push(await startTurnTimers(runtime, publish, runner));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(requests).toHaveLength(0);
    expect(games.getGameState(code)!.log.at(-1)).toMatchObject({ seat: 'N' });
  });
});
