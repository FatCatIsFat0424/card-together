import { statSync } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createApplication } from '../../src/app';
import { createJsonRepository } from '../../src/database/json-repository';
import type { Repository } from '../../src/database/repository';
import { isObject, validateDocument } from '../../src/database/schema';
import { isRuntimeSnapshot } from '../../src/runtime/validate';
import type { ControlMessage, ServerMessage, ServerStats, WritePhases, WriteSample } from './load-metrics';
import { loopDelay, summarizeWrites } from './load-metrics';

// The server under test for `bench:load`: production composition plus passive instrumentation,
// controlled by the benchmark over the IPC channel. Started only by load-benchmark.ts.

const LOOP_RESOLUTION_MS = 10;
const MEMORY_SAMPLE_MS = 1_000;

/** Every Repository method that may persist the document. */
const WRITE_METHODS = [
  'createAccount', 'updateProfile', 'purchaseAvatarBorder', 'purchaseShopItem', 'claimAchievement', 'replaceDailyTask',
  'claimDailyReward', 'changePassword', 'createSession', 'deleteSession', 'deleteAccountSessions', 'createFriendship',
  'acceptFriendship', 'deleteFriendship', 'createDirectMessage', 'markDirectMessagesRead', 'dismissFriendNotifications',
  'pruneSocialHistory', 'saveRuntime', 'saveMatch', 'createEmojis', 'deleteEmoji', 'deleteEmojis', 'renameEmoji',
] as const satisfies readonly (keyof Repository)[];

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function send(message: ServerMessage): void {
  if (!process.send) throw new Error('The load server must be started by the load benchmark.');
  process.send(message);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100;
}

/**
 * Times each step of a full-document write on the database as it was when the load stopped,
 * after the measured window and without other work running.
 */
async function measureWritePhases(databasePath: string, text: string, samples: number): Promise<WritePhases> {
  const document: unknown = JSON.parse(text);
  const runtime = isObject(document) ? document.runtime : null;
  const target = `${databasePath}.phases`;
  const timings = { validate: [] as number[], validateRuntime: [] as number[], stringify: [] as number[],
    encode: [] as number[], write: [] as number[] };
  try {
    for (let sample = 0; sample < samples; sample += 1) {
      let started = performance.now();
      validateDocument(document, { applyReplaySteps: false });
      timings.validate.push(performance.now() - started);
      started = performance.now();
      if (runtime !== null && !isRuntimeSnapshot(runtime, { applyReplaySteps: false })) throw new Error('Invalid runtime.');
      timings.validateRuntime.push(performance.now() - started);
      started = performance.now();
      const serialized = `${JSON.stringify(document)}\n`;
      timings.stringify.push(performance.now() - started);
      started = performance.now();
      const bytes = Buffer.from(serialized, 'utf8');
      timings.encode.push(performance.now() - started);
      started = performance.now();
      const temporary = `${target}.${sample}.tmp`;
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      timings.write.push(performance.now() - started);
    }
  } finally {
    await unlink(target).catch(() => undefined);
  }
  return {
    databaseBytes: Buffer.byteLength(text), runtimeBytes: Buffer.byteLength(JSON.stringify(runtime)), samples,
    validateMs: median(timings.validate), validateRuntimeMs: median(timings.validateRuntime),
    stringifyMs: median(timings.stringify), encodeMs: median(timings.encode), writeSyncRenameMs: median(timings.write),
  };
}

async function main(): Promise<void> {
  const databasePath = requiredEnvironment('LOAD_DATABASE_PATH');
  const origin = requiredEnvironment('LOAD_ORIGIN');
  const port = Number(requiredEnvironment('LOAD_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('LOAD_PORT must be a TCP port.');

  const repository = await createJsonRepository(databasePath);
  let writes: WriteSample[] = [];
  let lastWriteEnd = 0;
  const instrumented = repository as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const method of WRITE_METHODS) {
    const original = instrumented[method].bind(repository);
    instrumented[method] = async (...args: unknown[]): Promise<unknown> => {
      const started = performance.now();
      try {
        return await original(...args);
      } finally {
        const ended = performance.now();
        // Repository writes run one at a time in call order, so service starts when the previous one ends.
        const serviceStart = Math.max(started, lastWriteEnd);
        lastWriteEnd = ended;
        // A synchronous stat sees this write's file: the next queued write cannot rename before this continuation.
        const bytes = statSync(databasePath).size;
        writes.push({ method, durationMs: ended - started, serviceMs: ended - serviceStart, bytes });
      }
    };
  }

  const application = await createApplication(repository, {
    allowedOrigins: [origin], mediaDirectory: join(dirname(databasePath), 'media'), providedEmojis: new Map(),
    listen: { port, host: '127.0.0.1' },
  });
  application.httpServer.on('error', (error) => console.error('[load-server] HTTP server error:', error));

  const histogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  let windowStart = 0;
  let cpuStart = process.cpuUsage();
  let memorySampler: ReturnType<typeof setInterval> | undefined;
  const memory = { rssMax: 0, heapMax: 0 };
  let endOfLoad: Promise<string> | undefined;
  function sampleMemory(): NodeJS.MemoryUsage {
    const usage = process.memoryUsage();
    memory.rssMax = Math.max(memory.rssMax, usage.rss);
    memory.heapMax = Math.max(memory.heapMax, usage.heapUsed);
    return usage;
  }

  function stats(): ServerStats {
    const windowMs = performance.now() - windowStart;
    const cpu = process.cpuUsage(cpuStart);
    const usage = sampleMemory();
    return {
      windowMs, eventLoopDelayMs: loopDelay(histogram, LOOP_RESOLUTION_MS),
      cpu: { userMs: cpu.user / 1000, systemMs: cpu.system / 1000,
        coreUtilization: Math.round(((cpu.user + cpu.system) / 1000 / windowMs) * 1000) / 1000 },
      memory: { rssMaxBytes: memory.rssMax, rssFinalBytes: usage.rss, heapUsedMaxBytes: memory.heapMax,
        heapUsedFinalBytes: usage.heapUsed },
      writes: summarizeWrites(writes, windowMs),
      databaseBytes: statSync(databasePath).size,
    };
  }

  process.on('message', (message: ControlMessage) => {
    if (message.type === 'start') {
      writes = [];
      histogram.reset();
      histogram.enable();
      windowStart = performance.now();
      cpuStart = process.cpuUsage();
      memory.rssMax = 0;
      memory.heapMax = 0;
      sampleMemory();
      memorySampler = setInterval(sampleMemory, MEMORY_SAMPLE_MS);
    } else if (message.type === 'stop') {
      histogram.disable();
      clearInterval(memorySampler);
      send({ type: 'stats', stats: stats() });
      // Keep the document as the load left it, before clients disconnect and rooms empty.
      endOfLoad = readFile(databasePath, 'utf8');
    } else if (message.type === 'phases') {
      void application.close().then(async () => measureWritePhases(databasePath,
        await (endOfLoad ?? readFile(databasePath, 'utf8')), message.samples))
        .then((phases) => send({ type: 'phases', phases }))
        .catch((error: unknown) => {
          console.error('[load-server] Write phase measurement failed:', error);
          process.exitCode = 1;
        });
    }
  });
  // Closing the IPC channel means the benchmark is gone; never outlive it.
  process.on('disconnect', () => {
    void application.close().catch(() => undefined).finally(() => process.exit());
  });
  send({ type: 'ready', port });
}

void main().catch((error: unknown) => {
  console.error('[load-server] Startup failed:', error);
  process.exit(1);
});
