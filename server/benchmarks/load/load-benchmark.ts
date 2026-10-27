import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus, freemem, loadavg, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { DatabaseEngine } from '../../src/config';
import { TEST_ORIGIN } from '../../tests/performance/socket-harness';
import { createWorkload } from './load-clients';
import type { Recorder } from './load-clients';
import type { AckSummary, ControlMessage, ServerMessage, ServerStats, WritePhases } from './load-metrics';
import { evaluateTargets, formatSummary, loopDelay, summarize } from './load-metrics';
import { parseLoadOptions, planRooms } from './load-plan';
import { writeSyntheticDatabase } from './synthetic-database';

// Opt-in 100-player load benchmark: a synthetic database, the server in its own process on a free
// port, and scripted Socket.IO and HTTP clients. Writes only inside its temporary directory.

const RESERVED_PORT = 3001;
const READY_TIMEOUT_MS = 180_000;
const PHASES_TIMEOUT_MS = 300_000;
const EXIT_TIMEOUT_MS = 30_000;
const LOAD_SAMPLE_MS = 15_000;
const PROGRESS_MS = 60_000;
const SERVER_LOG_LIMIT = 200;
const SERVER_ERROR = /error|fail|unable/i;
/** Browser clients give up on an acknowledgment after this long. */
const CLIENT_ACK_TIMEOUT_MS = 10_000;

function log(message: string): void {
  console.warn(`[bench:load] ${message}`);
}

async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolvePort, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => address && typeof address === 'object' ? resolvePort(address.port) : reject(new Error('No port')));
      });
    });
    if (port !== RESERVED_PORT) return port;
  }
}

function cpuTimes(): { busy: number; total: number } {
  let busy = 0;
  let total = 0;
  for (const cpu of cpus()) {
    const { user, nice, sys, idle, irq } = cpu.times;
    busy += user + nice + sys + irq;
    total += user + nice + sys + idle + irq;
  }
  return { busy, total };
}

interface ServerProcess {
  readonly child: ChildProcess;
  readonly logLines: string[];
  errorLines: number;
  waitFor<T extends ServerMessage['type']>(reply: T, timeoutMs: number): Promise<Extract<ServerMessage, { type: T }>>;
  request<T extends ServerMessage['type']>(message: ControlMessage, reply: T, timeoutMs: number): Promise<Extract<ServerMessage, { type: T }>>;
  stop(): Promise<void>;
}

async function startServer(serverDirectory: string, engine: DatabaseEngine, databasePath: string, port: number): Promise<ServerProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./load-server.ts', import.meta.url))], {
    cwd: serverDirectory,
    env: { ...process.env, NODE_ENV: 'production', LOAD_DATABASE_ENGINE: engine, LOAD_DATABASE_PATH: databasePath,
      LOAD_PORT: String(port), LOAD_ORIGIN: TEST_ORIGIN },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const server: ServerProcess = {
    child, logLines: [], errorLines: 0,
    waitFor(reply, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(new Error(`The server did not send ${reply}.`)); }, timeoutMs);
        const onMessage = (received: ServerMessage): void => {
          if (received.type !== reply) return;
          cleanup();
          resolve(received as Extract<ServerMessage, { type: typeof reply }>);
        };
        const onExit = (code: number | null): void => { cleanup(); reject(new Error(`The server exited with ${code}.`)); };
        function cleanup(): void {
          clearTimeout(timer);
          child.off('message', onMessage);
          child.off('exit', onExit);
        }
        child.on('message', onMessage);
        child.once('exit', onExit);
      });
    },
    request(message, reply, timeoutMs) {
      const answer = server.waitFor(reply, timeoutMs);
      child.send(message);
      return answer;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      if (child.connected) child.disconnect();
      else child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), EXIT_TIMEOUT_MS);
      await exited;
      clearTimeout(timer);
    },
  };
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream! }).on('line', (line) => {
      if (SERVER_ERROR.test(line)) server.errorLines += 1;
      if (server.logLines.length < SERVER_LOG_LIMIT) server.logLines.push(line);
    });
  }
  await server.waitFor('ready', READY_TIMEOUT_MS);
  return server;
}

function ackSummaries(recorder: Recorder, include: (event: string) => boolean): Record<string, AckSummary> {
  return Object.fromEntries([...recorder.events].filter(([event]) => include(event))
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([event, entry]) => [event, { ...summarize(entry.latencies), failures: entry.failures }]));
}

function combined(recorder: Recorder, include: (event: string) => boolean): AckSummary & { overClientTimeout: number } {
  const entries = [...recorder.events].filter(([event]) => include(event)).map(([, entry]) => entry);
  const latencies = entries.flatMap((entry) => entry.latencies);
  return { ...summarize(latencies), failures: entries.reduce((sum, entry) => sum + entry.failures, 0),
    overClientTimeout: latencies.filter((latency) => latency > CLIENT_ACK_TIMEOUT_MS).length };
}

const isHttp = (event: string): boolean => /^(GET|POST) /.test(event);
const isSocketAck = (event: string): boolean => !isHttp(event) && event !== 'reconnect' && !event.startsWith('client:');

async function main(): Promise<void> {
  const options = parseLoadOptions(process.argv.slice(2));
  const serverDirectory = fileURLToPath(new URL('../..', import.meta.url));
  const startedAt = new Date().toISOString();
  const hostBefore = { loadAverage: loadavg(), freeMemoryBytes: freemem(), totalMemoryBytes: totalmem(), cpus: cpus().length };
  log(`Host load average before: ${hostBefore.loadAverage.map((value) => value.toFixed(2)).join(' ')}`);
  const directory = await mkdtemp(join(tmpdir(), 'card-together-load-'));
  let server: ServerProcess | undefined;
  let workload: ReturnType<typeof createWorkload> | undefined;
  let cleaning: Promise<void> | undefined;
  const cleanup = (): Promise<void> => {
    cleaning ??= (async (): Promise<void> => {
      workload?.close();
      try { await server?.stop(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    })();
    return cleaning;
  };
  const interrupt = (): void => { void cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    let started = performance.now();
    const database = await writeSyntheticDatabase(directory, {
      accounts: options.accounts, loadAccounts: options.clients, friendsPerAccount: options.friendsPerAccount,
      matchesPerAccount: options.matchesPerAccount, messagesPerAccount: options.messagesPerAccount, replays: options.replays,
      templatesPerGame: options.templatesPerGame,
    }, options.engine);
    const generateMs = performance.now() - started;
    log(`Synthetic ${options.engine} database: ${(database.summary.databaseBytes / 1024 / 1024).toFixed(1)} MiB, `
      + `${database.summary.matches} matches, ${database.summary.replayArchives} replays (${Math.round(generateMs)} ms`
      + `${database.summary.importMs === null ? '' : `, import ${database.summary.importMs} ms`})`);

    const port = await freePort();
    started = performance.now();
    server = await startServer(serverDirectory, options.engine, database.databasePath, port);
    const serverStartMs = performance.now() - started;
    log(`Server ready on 127.0.0.1:${port} (pid ${server.child.pid}, ${Math.round(serverStartMs)} ms)`);

    const plan = planRooms(options.clients, options.rooms);
    workload = createWorkload(plan, database.loadAccounts, {
      baseUrl: `http://127.0.0.1:${port}`, thinkMs: options.thinkMs, chatEveryMs: options.chatEveryMs,
      lobbyEveryMs: options.lobbyEveryMs, socialEveryMs: options.socialEveryMs, reconnectEveryMs: options.reconnectEveryMs,
      ackTimeoutMs: options.ackTimeoutMs,
    });
    started = performance.now();
    await workload.setup();
    const setupMs = performance.now() - started;
    log(`Setup: ${options.clients} clients, ${plan.rooms.length} rooms (${Math.round(setupMs)} ms)`);

    const benchLoop = monitorEventLoopDelay({ resolution: 10 });
    benchLoop.enable();
    const benchCpu = process.cpuUsage();
    const hostCpu = cpuTimes();
    const loadSamples: number[][] = [loadavg()];
    const sampler = setInterval(() => loadSamples.push(loadavg()), LOAD_SAMPLE_MS);
    const windowStarted = performance.now();
    server.child.send({ type: 'start' } satisfies ControlMessage);
    workload.start();
    const progress = setInterval(() => {
      const events = [...workload!.results().window.events.values()];
      log(`${Math.round((performance.now() - windowStarted) / 1000)} s: ${events.reduce((sum, entry) => sum + entry.latencies.length, 0)} requests, `
        + `${events.reduce((sum, entry) => sum + entry.failures, 0)} failures`);
    }, PROGRESS_MS);
    await new Promise((resolve) => setTimeout(resolve, options.durationSeconds * 1000));
    clearInterval(progress);
    const loadEnded = performance.now();
    await workload.stop();
    const drainMs = performance.now() - loadEnded;
    const { stats } = await server.request({ type: 'stop' }, 'stats', 60_000);
    const windowMs = performance.now() - windowStarted;
    clearInterval(sampler);
    loadSamples.push(loadavg());
    benchLoop.disable();
    const benchCpuUsed = process.cpuUsage(benchCpu);
    const hostCpuEnd = cpuTimes();
    const results = workload.results();
    workload.close();

    let phases: WritePhases | null = null;
    if (options.writePhaseSamples > 0) {
      ({ phases } = await server.request({ type: 'phases', samples: options.writePhaseSamples }, 'phases', PHASES_TIMEOUT_MS));
    }
    await server.stop();

    const window = results.window;
    const socketAcks = combined(window, isSocketAck);
    const failures = [...window.events.values()].reduce((sum, entry) => sum + entry.failures, 0);
    const targets = evaluateTargets({
      ackP95Ms: socketAcks.p95, ackP99Ms: socketAcks.p99, loopDelayP99Ms: stats.eventLoopDelayMs.p99,
      rssMaxBytes: stats.memory.rssMaxBytes, errors: failures + server.errorLines,
      unexpectedDisconnects: results.unexpectedDisconnects.length,
    });
    const hostCpuUtilization = (hostCpuEnd.busy - hostCpu.busy) / Math.max(1, hostCpuEnd.total - hostCpu.total);
    const host = {
      ...hostBefore, loadAverageAfter: loadavg(), loadAverageSamples: loadSamples,
      cpuUtilization: Math.round(hostCpuUtilization * 1000) / 1000,
    };
    const report = {
      benchmark: 'load', node: process.version, platform: process.platform, arch: process.arch, startedAt,
      finishedAt: new Date().toISOString(), options,
      timingsMs: { generate: Math.round(generateMs), serverStart: Math.round(serverStartMs), setup: Math.round(setupMs),
        window: Math.round(windowMs), drain: Math.round(drainMs) },
      host,
      database: { ...database.summary, finalBytes: stats.databaseBytes },
      workload: {
        rooms: plan.rooms, lobbyClients: plan.lobby, gamesCompleted: results.gamesCompleted, reconnects: results.reconnects,
        snapshotsReceived: results.snapshotsReceived, chatMessagesReceived: results.chatMessagesReceived,
      },
      targets,
      acks: {
        socket: socketAcks, http: combined(window, isHttp),
        byEvent: ackSummaries(window, () => true),
        setup: ackSummaries(results.setup, () => true),
      },
      errors: {
        requestFailures: failures,
        byMessage: Object.fromEntries([...window.failureMessages].sort(([, first], [, second]) => second - first)),
        setupFailures: [...results.setup.events.values()].reduce((sum, entry) => sum + entry.failures, 0),
        unexpectedDisconnects: results.unexpectedDisconnects,
        serverErrorLines: server.errorLines,
      },
      server: stats satisfies ServerStats,
      writePhases: phases,
      bench: {
        eventLoopDelayMs: loopDelay(benchLoop, 10),
        cpu: { userMs: benchCpuUsed.user / 1000, systemMs: benchCpuUsed.system / 1000 },
      },
      serverLog: server.logLines,
    };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) await writeFile(options.output, json);
    process.stdout.write(json);
    process.stderr.write(`\n${formatSummary({
      engine: options.engine, durationMs: windowMs, drainMs, clients: options.clients, rooms: plan.rooms.length,
      databaseBytes: stats.databaseBytes,
      targets, acks: ackSummaries(window, () => true), server: stats, phases,
      host: { loadAverage: host.loadAverageAfter, cpuUtilization: host.cpuUtilization },
    })}`);
  } finally {
    await cleanup();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
