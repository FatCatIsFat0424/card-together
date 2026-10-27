import type { DatabaseEngine } from '../../src/config';

// Pure helpers and report contracts shared by the load benchmark and its server process.

export interface LatencySummary {
  readonly count: number;
  readonly mean: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly max: number | null;
}

/** Nearest-rank percentile of ascending samples; null when there are none. */
export function percentile(sorted: readonly number[], rank: number): number | null {
  if (!(rank >= 0 && rank <= 100)) throw new RangeError('Percentile rank must be between 0 and 100.');
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1);
  return sorted[index];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) return { count: 0, mean: null, p50: null, p95: null, p99: null, max: null };
  const sorted = [...samples].sort((first, second) => first - second);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length, mean: round(total / sorted.length), p50: round(percentile(sorted, 50)!),
    p95: round(percentile(sorted, 95)!), p99: round(percentile(sorted, 99)!), max: round(sorted[sorted.length - 1]),
  };
}

/** Event loop delay in milliseconds beyond the histogram's sampling interval. */
export interface LoopDelaySummary {
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** Reads a `monitorEventLoopDelay` histogram (nanoseconds) and removes its sampling interval. */
export function loopDelay(histogram: {
  percentile(rank: number): number; readonly max: number; readonly mean: number; readonly count: number;
}, resolutionMs: number): LoopDelaySummary {
  if (histogram.count === 0) return { p50: 0, p99: 0, max: 0, mean: 0 };
  const delay = (nanoseconds: number): number => round(Math.max(0, nanoseconds / 1e6 - resolutionMs));
  return {
    p50: delay(histogram.percentile(50)), p99: delay(histogram.percentile(99)),
    max: delay(histogram.max), mean: delay(histogram.mean),
  };
}

export interface WriteSample {
  readonly method: string;
  /** From the call until it resolved, including time queued behind other repository writes. */
  readonly durationMs: number;
  /** From when the previous write finished (or the call, if later) until it resolved. */
  readonly serviceMs: number;
  readonly bytes: number;
}

export interface WriteSummary {
  readonly count: number;
  readonly perSecond: number;
  readonly durationMs: LatencySummary;
  readonly serviceMs: LatencySummary;
  readonly queueWaitMs: LatencySummary;
  readonly bytes: LatencySummary;
  /** Share of the window the repository spent writing; at 1 every new write must queue. */
  readonly busyFraction: number;
  readonly byMethod: Readonly<Record<string, { readonly count: number; readonly serviceMs: LatencySummary }>>;
}

export function summarizeWrites(samples: readonly WriteSample[], windowMs: number): WriteSummary {
  const byMethod = new Map<string, number[]>();
  for (const sample of samples) {
    const values = byMethod.get(sample.method);
    if (values) values.push(sample.serviceMs);
    else byMethod.set(sample.method, [sample.serviceMs]);
  }
  const busy = samples.reduce((sum, sample) => sum + sample.serviceMs, 0);
  return {
    count: samples.length,
    perSecond: windowMs > 0 ? round(samples.length / (windowMs / 1000)) : 0,
    durationMs: summarize(samples.map((sample) => sample.durationMs)),
    serviceMs: summarize(samples.map((sample) => sample.serviceMs)),
    queueWaitMs: summarize(samples.map((sample) => Math.max(0, sample.durationMs - sample.serviceMs))),
    bytes: summarize(samples.map((sample) => sample.bytes)),
    busyFraction: windowMs > 0 ? Math.round(Math.min(1, busy / windowMs) * 1000) / 1000 : 0,
    byMethod: Object.fromEntries([...byMethod].sort(([first], [second]) => first.localeCompare(second))
      .map(([method, values]) => [method, { count: values.length, serviceMs: summarize(values) }])),
  };
}

export interface MemorySummary {
  readonly rssMaxBytes: number;
  readonly rssFinalBytes: number;
  readonly heapUsedMaxBytes: number;
  readonly heapUsedFinalBytes: number;
}

export interface JsonWritePhases {
  readonly engine: 'json';
  readonly databaseBytes: number;
  /** The runtime snapshot (players, rooms, games, chat) inside the document. */
  readonly runtimeBytes: number;
  readonly samples: number;
  /** Median milliseconds of each step of one full-document write, measured without load. */
  readonly validateMs: number;
  /** The runtime snapshot's share of `validateMs`. */
  readonly validateRuntimeMs: number;
  readonly stringifyMs: number;
  readonly encodeMs: number;
  readonly writeSyncRenameMs: number;
}

/** Median milliseconds of each step of a runtime write on SQLite, measured without load. */
export interface SqliteWritePhases {
  readonly engine: 'sqlite';
  readonly databaseBytes: number;
  readonly runtimeBytes: number;
  readonly samples: number;
  readonly validateRuntimeMs: number;
  /** Serializing every runtime row to find the changed ones. */
  readonly serializeRuntimeMs: number;
  /** A transaction that rewrites the largest game row, including the synced commit. */
  readonly commitOneGameMs: number;
  /** A transaction that rewrites every runtime row, including the synced commit. */
  readonly commitWholeRuntimeMs: number;
}

export type WritePhases = JsonWritePhases | SqliteWritePhases;

/** What the server process reports for the measurement window. */
export interface ServerStats {
  readonly windowMs: number;
  readonly eventLoopDelayMs: LoopDelaySummary;
  readonly cpu: { readonly userMs: number; readonly systemMs: number; readonly coreUtilization: number };
  readonly memory: MemorySummary;
  readonly writes: WriteSummary;
  readonly databaseBytes: number;
}

export type ServerMessage =
  | { readonly type: 'ready'; readonly port: number }
  | { readonly type: 'stats'; readonly stats: ServerStats }
  | { readonly type: 'phases'; readonly phases: WritePhases };

export type ControlMessage = { readonly type: 'start' } | { readonly type: 'stop' } | { readonly type: 'phases'; readonly samples: number };

export interface AckSummary extends LatencySummary {
  readonly failures: number;
}

export interface TargetResult {
  readonly name: string;
  readonly limit: string;
  readonly actual: string;
  readonly pass: boolean;
}

export interface TargetInputs {
  readonly ackP95Ms: number | null;
  readonly ackP99Ms: number | null;
  readonly loopDelayP99Ms: number;
  readonly rssMaxBytes: number;
  readonly errors: number;
  readonly unexpectedDisconnects: number;
}

const MIB = 1024 * 1024;

/** The P0-2 acceptance targets; reported, never used to tune the workload. */
export function evaluateTargets(inputs: TargetInputs): TargetResult[] {
  const ms = (value: number | null): string => value === null ? 'n/a' : `${value} ms`;
  return [
    { name: 'Ack latency p95', limit: '<= 150 ms', actual: ms(inputs.ackP95Ms),
      pass: inputs.ackP95Ms !== null && inputs.ackP95Ms <= 150 },
    { name: 'Ack latency p99', limit: '<= 500 ms', actual: ms(inputs.ackP99Ms),
      pass: inputs.ackP99Ms !== null && inputs.ackP99Ms <= 500 },
    { name: 'Event loop delay p99', limit: '<= 50 ms', actual: ms(inputs.loopDelayP99Ms), pass: inputs.loopDelayP99Ms <= 50 },
    { name: 'Server RSS max', limit: '< 768 MiB', actual: `${round(inputs.rssMaxBytes / MIB)} MiB`,
      pass: inputs.rssMaxBytes < 768 * MIB },
    { name: 'Errors', limit: '0', actual: String(inputs.errors), pass: inputs.errors === 0 },
    { name: 'Unexpected disconnects', limit: '0', actual: String(inputs.unexpectedDisconnects),
      pass: inputs.unexpectedDisconnects === 0 },
  ];
}

function cell(value: number | null): string {
  return value === null ? '-' : String(value);
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (row: readonly string[]): string => row.map((value, column) => value.padEnd(widths[column])).join('  ').trimEnd();
  return [line(header), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)];
}

export interface SummaryInputs {
  readonly engine: DatabaseEngine;
  /** The whole measured window, including the drain of requests sent before the load stopped. */
  readonly durationMs: number;
  readonly drainMs: number;
  readonly clients: number;
  readonly rooms: number;
  readonly databaseBytes: number;
  readonly targets: readonly TargetResult[];
  readonly acks: Readonly<Record<string, AckSummary>>;
  readonly server: ServerStats;
  readonly phases: WritePhases | null;
  readonly host: { readonly loadAverage: readonly number[]; readonly cpuUtilization: number };
}

/** A short plain-text summary; the JSON report holds every number. */
export function formatSummary(inputs: SummaryInputs): string {
  const { server } = inputs;
  const lines = [
    `Load benchmark: ${round(inputs.durationMs / 1000)} s window (${round(inputs.drainMs / 1000)} s drain), `
      + `${inputs.clients} clients, ${inputs.rooms} rooms, `
      + `${inputs.engine} database ${round(inputs.databaseBytes / MIB)} MiB`,
    `Host: load average ${inputs.host.loadAverage.map((value) => value.toFixed(2)).join(' ')}, `
      + `CPU ${round(inputs.host.cpuUtilization * 100)}% of all cores during the window`,
    '',
    ...table(['Target', 'Limit', 'Actual', 'Result'],
      inputs.targets.map((target) => [target.name, target.limit, target.actual, target.pass ? 'pass' : 'FAIL'])),
    '',
    ...table(['Event', 'Count', 'Fail', 'p50 ms', 'p95 ms', 'p99 ms', 'Max ms'],
      Object.entries(inputs.acks).sort(([, first], [, second]) => (second.p95 ?? 0) - (first.p95 ?? 0))
        .map(([name, ack]) => [name, String(ack.count), String(ack.failures), cell(ack.p50), cell(ack.p95), cell(ack.p99),
          cell(ack.max)])),
    '',
    `Writes: ${server.writes.count} (${server.writes.perSecond}/s), service p50/p95/p99 `
      + `${cell(server.writes.serviceMs.p50)}/${cell(server.writes.serviceMs.p95)}/${cell(server.writes.serviceMs.p99)} ms, `
      + `queued p95 ${cell(server.writes.queueWaitMs.p95)} ms, mean ${round((server.writes.bytes.mean ?? 0) / 1024)} KiB, `
      + `busy ${round(server.writes.busyFraction * 100)}%`,
    `Event loop delay p50/p99/max: ${server.eventLoopDelayMs.p50}/${server.eventLoopDelayMs.p99}/${server.eventLoopDelayMs.max} ms`,
    `Server CPU: ${round(server.cpu.coreUtilization * 100)}% of one core; RSS max ${round(server.memory.rssMaxBytes / MIB)} MiB, `
      + `heap max ${round(server.memory.heapUsedMaxBytes / MIB)} MiB`,
  ];
  const { phases } = inputs;
  if (phases?.engine === 'json') {
    lines.push(`One write at ${round(phases.databaseBytes / MIB)} MiB without load: validate ${phases.validateMs} ms `
      + `(runtime ${phases.validateRuntimeMs} ms for ${round(phases.runtimeBytes / MIB)} MiB), stringify ${phases.stringifyMs} ms, `
      + `encode ${phases.encodeMs} ms, write+fsync+rename ${phases.writeSyncRenameMs} ms`);
  } else if (phases?.engine === 'sqlite') {
    lines.push(`One runtime write at ${round(phases.databaseBytes / MIB)} MiB SQLite without load: validate `
      + `${phases.validateRuntimeMs} ms for ${round(phases.runtimeBytes / MIB)} MiB, serialize ${phases.serializeRuntimeMs} ms, `
      + `commit one game ${phases.commitOneGameMs} ms, commit whole runtime ${phases.commitWholeRuntimeMs} ms`);
  }
  return `${lines.join('\n')}\n`;
}
