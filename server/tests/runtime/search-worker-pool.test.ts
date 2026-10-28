import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOT_WORKER_DEFAULTS, parseBotWorkerConfig } from '../../src/config';
import { createSearchPool } from '../../src/bots/search/search-worker-pool';
import type { SearchPool } from '../../src/bots/search/search-worker-pool';
import { searchStrategy } from '../../src/bots/search/search-types';
import type { SearchTask } from '../../src/bots/search/search-types';
import { seededRandom, seedFromText } from '../../src/bots/search/seeded-random';

const fixtureModule = new URL('../fixtures/search-strategies.ts', import.meta.url);

function task(exportName: string, overrides: Partial<SearchTask> = {}): SearchTask {
  return { strategy: searchStrategy(fixtureModule, exportName), visible: {}, budgetMs: 1_000, seed: 1, ...overrides };
}

describe('search worker pool', () => {
  const pools: SearchPool[] = [];
  function open(options: Partial<Parameters<typeof createSearchPool>[0]> = {}): SearchPool {
    const pool = createSearchPool({ workers: 1, memoryMb: 128, queueLimit: 4, ...options });
    pools.push(pool);
    return pool;
  }
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(pools.splice(0).map((pool) => pool.close()));
  });

  it('starts workers on first use, reuses them, and stops them on close', async () => {
    const pool = open({ workers: 2 });
    expect(pool.stats()).toMatchObject({ alive: 0, busy: 0, queued: 0 });
    const first = await pool.run(task('echoSearch'));
    expect(first.status).toBe('ok');
    expect(pool.stats()).toMatchObject({ alive: 1, busy: 0, completed: 1 });
    await pool.run(task('echoSearch'));
    expect(pool.stats()).toMatchObject({ alive: 1, completed: 2 });
    await pool.close();
    expect(pool.stats().alive).toBe(0);
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'closed' });
  });

  it('gives equal seeds equal results and passes the depth cap to the strategy', async () => {
    const pool = open({ workers: 2 });
    const [a, b, other] = await Promise.all([
      pool.run(task('echoSearch', { seed: 77, maxDepth: 4 })),
      pool.run(task('echoSearch', { seed: 77, maxDepth: 4 })),
      pool.run(task('echoSearch', { seed: 78, maxDepth: 4 })),
    ]);
    expect(a).toMatchObject({ status: 'ok' });
    expect(a.status === 'ok' && b.status === 'ok' && a.action).toEqual(b.status === 'ok' && b.action);
    expect(a.status === 'ok' && other.status === 'ok' && a.action).not.toEqual(other.status === 'ok' && other.action);
    expect(pool.stats().alive).toBe(2);
    // The worker's generator is the same one the main thread can reproduce.
    const random = seededRandom(77);
    expect(a.status === 'ok' && a.action).toEqual({
      type: 'liarsdeck-play', cardIds: [Math.floor(random() * 1e9), Math.floor(random() * 1e9), Math.floor(random() * 1e9), 4],
    });
  });

  it('terminates a search that overruns its budget and starts a fresh worker for the next task', async () => {
    const pool = open({ graceMs: 50 });
    const started = Date.now();
    const outcome = await pool.run(task('spinSearch', { budgetMs: 100 }));
    expect(outcome.status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(pool.stats()).toMatchObject({ alive: 0, timeouts: 1 });
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'ok' });
    expect(pool.stats()).toMatchObject({ alive: 1, completed: 1 });
  });

  it('respawns after a crash and reports it to the caller only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = open();
    await expect(pool.run(task('crashSearch'))).resolves.toMatchObject({ status: 'crashed' });
    expect(pool.stats()).toMatchObject({ alive: 0, crashes: 1 });
    expect(error).toHaveBeenCalled();
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'ok' });
    expect(pool.stats()).toMatchObject({ alive: 1, crashes: 1, completed: 1 });
  });

  it('treats a worker that exceeds its memory cap as a crash', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = open({ memoryMb: 32 });
    await expect(pool.run(task('memorySearch', { budgetMs: 5_000 }))).resolves.toMatchObject({ status: 'crashed' });
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'ok' });
  });

  it('keeps the worker when a strategy throws or is missing', async () => {
    const pool = open();
    await expect(pool.run(task('throwSearch'))).resolves.toMatchObject({ status: 'failed', reason: 'search exploded' });
    await expect(pool.run(task('notAFunction'))).resolves.toMatchObject({ status: 'failed' });
    await expect(pool.run(task('missingExport'))).resolves.toMatchObject({ status: 'failed' });
    expect(pool.stats()).toMatchObject({ alive: 1, failures: 3, crashes: 0 });
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'ok' });
  });

  it('queues beyond the worker count, then rejects past the queue limit', async () => {
    const pool = open({ queueLimit: 1 });
    const running = pool.run(task('sleepSearch', { visible: { waitMs: 150 } }));
    const queued = pool.run(task('echoSearch'));
    expect(pool.stats()).toMatchObject({ busy: 1, queued: 1 });
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'rejected' });
    await expect(running).resolves.toMatchObject({ status: 'ok' });
    await expect(queued).resolves.toMatchObject({ status: 'ok' });
    expect(pool.stats()).toMatchObject({ rejected: 1, queued: 0 });
  });

  it('rejects a task that waits too long for a worker', async () => {
    const pool = open({ maxWaitMs: 60 });
    const running = pool.run(task('sleepSearch', { visible: { waitMs: 300 }, budgetMs: 1_000 }));
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'rejected' });
    await running;
  });

  it('cancels queued and running tasks', async () => {
    const pool = open();
    const runningAbort = new AbortController();
    const queuedAbort = new AbortController();
    const running = pool.run(task('spinSearch', { budgetMs: 5_000 }), runningAbort.signal);
    const queued = pool.run(task('echoSearch'), queuedAbort.signal);
    queuedAbort.abort();
    await expect(queued).resolves.toMatchObject({ status: 'cancelled' });
    expect(pool.stats().queued).toBe(0);
    // Wait until the spinning search owns the worker, then cancel it.
    await vi.waitFor(() => expect(pool.stats().busy).toBe(1));
    runningAbort.abort();
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(pool.stats().alive).toBe(0);
    await expect(pool.run(task('echoSearch'), runningAbort.signal)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('resolves outstanding tasks as closed when the pool shuts down', async () => {
    const pool = open();
    const running = pool.run(task('spinSearch', { budgetMs: 5_000 }));
    const queued = pool.run(task('echoSearch'));
    await vi.waitFor(() => expect(pool.stats().busy).toBe(1));
    await pool.close();
    await expect(running).resolves.toMatchObject({ status: 'closed' });
    await expect(queued).resolves.toMatchObject({ status: 'closed' });
  });

  it('rejects every task when no workers are configured', async () => {
    const pool = open({ workers: 0 });
    await expect(pool.run(task('echoSearch'))).resolves.toMatchObject({ status: 'rejected' });
  });
});

describe('seeded random', () => {
  it('repeats a sequence per seed and spreads values over [0, 1)', () => {
    const first = seededRandom(5);
    const second = seededRandom(5);
    const values = Array.from({ length: 50 }, () => first());
    expect(values).toEqual(Array.from({ length: 50 }, () => second()));
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(values).size).toBe(50);
    expect(seedFromText('game:playing:3:S')).toBe(seedFromText('game:playing:3:S'));
    expect(seedFromText('game:playing:3:S')).not.toBe(seedFromText('game:playing:4:S'));
  });
});

describe('bot worker configuration', () => {
  it('uses documented defaults when unset or empty', () => {
    expect(parseBotWorkerConfig(undefined, undefined, undefined)).toEqual(BOT_WORKER_DEFAULTS);
    expect(parseBotWorkerConfig('', '', '')).toEqual(BOT_WORKER_DEFAULTS);
  });

  it('accepts in-range integers, including 0 workers to switch the pool off', () => {
    expect(parseBotWorkerConfig('0', '256', '8')).toEqual({ workers: 0, memoryMb: 256, queueLimit: 8 });
    expect(parseBotWorkerConfig('8', '32', '0')).toEqual({ workers: 8, memoryMb: 32, queueLimit: 0 });
  });

  it.each([
    ['BOT_WORKERS', ['-1', '9', '1.5', 'two', '1e1', ' 2']],
    ['BOT_WORKER_MEMORY_MB', ['31', '1025', '0x80', 'lots']],
    ['BOT_SEARCH_QUEUE', ['-1', '1025', '3.2']],
  ] as const)('stops startup on an invalid %s', (name, values) => {
    for (const value of values) {
      const args: [string | undefined, string | undefined, string | undefined] = [undefined, undefined, undefined];
      args[['BOT_WORKERS', 'BOT_WORKER_MEMORY_MB', 'BOT_SEARCH_QUEUE'].indexOf(name)] = value;
      expect(() => parseBotWorkerConfig(...args)).toThrow(name);
    }
  });
});
