import { describe, expect, it } from 'vitest';
import { evaluateTargets, formatSummary, loopDelay, percentile, summarize, summarizeWrites } from '../../benchmarks/load/load-metrics';
import type { ServerStats } from '../../benchmarks/load/load-metrics';
import { DEFAULT_LOAD_OPTIONS, parseLoadOptions, planRooms, SMOKE_DURATION_SECONDS } from '../../benchmarks/load/load-plan';

const MIB = 1024 * 1024;

describe('load benchmark statistics', () => {
  it('should use nearest-rank percentiles and report nothing for no samples', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect([0, 1, 10, 50, 51, 95, 99, 100].map((rank) => percentile(sorted, rank))).toEqual([1, 1, 1, 5, 6, 10, 10, 10]);
    expect(percentile([], 50)).toBeNull();
    expect(() => percentile(sorted, 101)).toThrow(RangeError);
    expect(summarize([])).toEqual({ count: 0, mean: null, p50: null, p95: null, p99: null, max: null });
  });

  it('should summarize unsorted samples without reordering the caller\'s array', () => {
    const samples = [30, 10, 20.004, 40];
    expect(summarize(samples)).toEqual({ count: 4, mean: 25, p50: 20, p95: 40, p99: 40, max: 40 });
    expect(samples).toEqual([30, 10, 20.004, 40]);
  });

  it('should subtract the sampling interval from event loop delays and floor them at zero', () => {
    const values: Record<number, number> = { 50: 9_500_000, 99: 62_000_000 };
    expect(loopDelay({ percentile: (rank) => values[rank], max: 90_000_000, mean: 12_000_000, count: 5 }, 10))
      .toEqual({ p50: 0, p99: 52, max: 80, mean: 2 });
    expect(loopDelay({ percentile: () => 0, max: 0, mean: 0, count: 0 }, 10)).toEqual({ p50: 0, p99: 0, max: 0, mean: 0 });
  });

  it('should derive write rate, queue wait, busy share, and per-method counts', () => {
    const writes = summarizeWrites([
      { method: 'saveRuntime', durationMs: 100, serviceMs: 100, bytes: 2 * MIB },
      { method: 'saveRuntime', durationMs: 150, serviceMs: 50, bytes: 2 * MIB },
      { method: 'createDirectMessage', durationMs: 50, serviceMs: 50, bytes: 4 * MIB },
    ], 1_000);
    expect(writes).toMatchObject({ count: 3, perSecond: 3, busyFraction: 0.2,
      queueWaitMs: { p50: 0, max: 100 }, bytes: { max: 4 * MIB } });
    expect(writes.byMethod).toEqual({
      createDirectMessage: { count: 1, serviceMs: summarize([50]) },
      saveRuntime: { count: 2, serviceMs: summarize([100, 50]) },
    });
    expect(summarizeWrites([{ method: 'saveRuntime', durationMs: 5_000, serviceMs: 5_000, bytes: 1 }], 1_000).busyFraction).toBe(1);
  });
});

describe('load benchmark targets and summary', () => {
  const passing = { ackP95Ms: 150, ackP99Ms: 500, loopDelayP99Ms: 50, rssMaxBytes: 768 * MIB - 1, errors: 0, unexpectedDisconnects: 0 };

  it('should pass exactly at the limits and fail just past them or without samples', () => {
    expect(evaluateTargets(passing).every((target) => target.pass)).toBe(true);
    const failing = evaluateTargets({ ackP95Ms: 150.01, ackP99Ms: null, loopDelayP99Ms: 50.01, rssMaxBytes: 768 * MIB,
      errors: 1, unexpectedDisconnects: 1 });
    expect(failing.map((target) => [target.name, target.pass, target.actual])).toEqual([
      ['Ack latency p95', false, '150.01 ms'], ['Ack latency p99', false, 'n/a'], ['Event loop delay p99', false, '50.01 ms'],
      ['Server RSS max', false, '768 MiB'], ['Errors', false, '1'], ['Unexpected disconnects', false, '1'],
    ]);
  });

  it('should print targets, the slowest events first, writes, and write phases', () => {
    const writes = summarizeWrites([{ method: 'saveRuntime', durationMs: 30, serviceMs: 20, bytes: 2 * MIB }], 10_000);
    const server: ServerStats = {
      windowMs: 10_000, eventLoopDelayMs: { p50: 0.1, p99: 12, max: 40, mean: 0.5 },
      cpu: { userMs: 4_000, systemMs: 1_000, coreUtilization: 0.5 },
      memory: { rssMaxBytes: 300 * MIB, rssFinalBytes: 200 * MIB, heapUsedMaxBytes: 100 * MIB, heapUsedFinalBytes: 90 * MIB },
      writes, databaseBytes: 2 * MIB,
    };
    const summary = formatSummary({
      durationMs: 10_000, drainMs: 500, clients: 100, rooms: 20, databaseBytes: 2 * MIB, server,
      targets: evaluateTargets({ ...passing, ackP95Ms: 200 }),
      acks: {
        'chat:send': { ...summarize([5, 6]), failures: 0 },
        'game:playCard': { ...summarize([40, 300]), failures: 1 },
        'GET /api/friends': { ...summarize([]), failures: 0 },
      },
      phases: { databaseBytes: 2 * MIB, runtimeBytes: MIB / 2, samples: 3, validateMs: 10, validateRuntimeMs: 6, stringifyMs: 8,
        encodeMs: 1, writeSyncRenameMs: 4 },
      host: { loadAverage: [1, 0.5, 0.25], cpuUtilization: 0.125 },
    });
    const lines = summary.split('\n');
    expect(lines[0]).toBe('Load benchmark: 10 s window (0.5 s drain), 100 clients, 20 rooms, database 2 MiB');
    expect(lines[1]).toBe('Host: load average 1.00 0.50 0.25, CPU 12.5% of all cores during the window');
    expect(lines).toContain('Ack latency p95         <= 150 ms  200 ms   FAIL');
    const events = lines.filter((line) => /^(game|chat|GET)/.test(line));
    expect(events.map((line) => line.split(/\s+/)[0])).toEqual(['game:playCard', 'chat:send', 'GET']);
    expect(events[0]).toBe('game:playCard     2      1     40      300     300     300');
    expect(events[2]).toBe('GET /api/friends  0      0     -       -       -       -');
    expect(summary).toContain('Writes: 1 (0.1/s), service p50/p95/p99 20/20/20 ms, queued p95 10 ms, mean 2 MiB, busy 0.2%');
    expect(summary).toContain('One write at 2 MiB without load: validate 10 ms (runtime 6 ms for 0.5 MiB), stringify 8 ms, '
      + 'encode 1 ms, write+fsync+rename 4 ms');
    expect(summary.endsWith('\n')).toBe(true);
  });
});

describe('load benchmark plan and options', () => {
  it('should seat 100 clients at 20 mixed rooms with bots, spectators, and a lobby', () => {
    const plan = planRooms(100, 20);
    expect(plan.rooms).toHaveLength(20);
    expect(new Set(plan.rooms.map((room) => room.gameType)).size).toBe(10);
    expect(plan.rooms.every((room) => room.humans + room.bots === 4 && room.humans >= 2)).toBe(true);
    expect(plan.rooms.filter((room) => room.bots > 0)).toHaveLength(6);
    const seated = plan.rooms.reduce((sum, room) => sum + room.humans + room.spectators, 0);
    expect([seated, plan.lobby]).toEqual([78, 22]);
  });

  it('should drop rooms and spectators rather than exceed the clients', () => {
    expect(planRooms(5, 20)).toEqual({ rooms: [
      { gameType: 'bridge', humans: 4, bots: 0, spectators: 0 }, { gameType: 'bigtwo', humans: 1, bots: 3, spectators: 0 },
    ], lobby: 0 });
    expect(() => planRooms(0, 1)).toThrow(RangeError);
  });

  it('should default to ten minutes and shorten only the duration in smoke mode', () => {
    expect(parseLoadOptions([])).toEqual(DEFAULT_LOAD_OPTIONS);
    expect(parseLoadOptions(['--smoke'])).toEqual({ ...DEFAULT_LOAD_OPTIONS, durationSeconds: SMOKE_DURATION_SECONDS });
    expect(parseLoadOptions(['--duration', '90', '--smoke', '--accounts', '300', '--output', '/tmp/report.json']))
      .toMatchObject({ durationSeconds: 90, accounts: 300, output: '/tmp/report.json' });
    expect(() => parseLoadOptions(['--clients', '1.5'])).toThrow('--clients must be a non-negative integer.');
    expect(() => parseLoadOptions(['--accounts', '10'])).toThrow('--accounts must be at least --clients.');
    expect(() => parseLoadOptions(['--unknown', '1'])).toThrow('Unknown option --unknown.');
    expect(() => parseLoadOptions(['--duration'])).toThrow('--duration needs a value.');
  });
});
