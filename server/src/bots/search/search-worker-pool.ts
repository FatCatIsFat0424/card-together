import { Worker } from 'node:worker_threads';
import type { SearchOutcome, SearchRunner, SearchTask, WorkerMessage, WorkerRequest } from './search-types';

export interface BotWorkerConfig {
  /** Concurrent search workers; 0 disables the pool and every search bot uses its synchronous fallback. */
  readonly workers: number;
  /** V8 old-generation cap per worker in MiB; a worker past it is terminated and counts as a crash. */
  readonly memoryMb: number;
  /** Tasks allowed to wait for a free worker; further tasks are rejected at once. */
  readonly queueLimit: number;
}

export interface SearchPoolOptions extends BotWorkerConfig {
  /** Extra time after a task's budget before its worker is terminated. */
  readonly graceMs?: number;
  /** Longest a task may wait for a worker, including worker start-up. */
  readonly maxWaitMs?: number;
  /** Longest a new worker may take to report ready. */
  readonly startupMs?: number;
  readonly workerUrl?: URL;
}

export interface SearchPoolStats {
  readonly alive: number;
  readonly busy: number;
  readonly queued: number;
  readonly completed: number;
  readonly timeouts: number;
  readonly crashes: number;
  readonly failures: number;
  readonly rejected: number;
}

export interface SearchPool extends SearchRunner {
  readonly stats: () => SearchPoolStats;
  readonly close: () => Promise<void>;
}

export const DEFAULT_SEARCH_GRACE_MS = 250;
export const DEFAULT_SEARCH_MAX_WAIT_MS = 3_000;
export const DEFAULT_WORKER_STARTUP_MS = 15_000;

const DEFAULT_WORKER_URL = new URL('./search-worker-entry.mjs', import.meta.url);

interface Waiting {
  readonly task: SearchTask;
  readonly settle: (outcome: SearchOutcome) => void;
  readonly waitTimer: ReturnType<typeof setTimeout>;
}

interface Running {
  readonly id: number;
  readonly task: SearchTask;
  readonly settle: (outcome: SearchOutcome) => void;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Slot {
  worker: Worker | null;
  ready: boolean;
  startupTimer: ReturnType<typeof setTimeout> | null;
  running: Running | null;
}

/**
 * Runs search strategies on `worker_threads` so a long search never blocks the event loop.
 *
 * - Workers start on first use, so servers without search bots pay nothing.
 * - A task that overruns `budgetMs + graceMs`, a cancelled task, and a crashed worker all end with the
 *   worker terminated; the slot starts a fresh worker for the next task.
 * - `run` always resolves. Anything but `status: 'ok'` tells the caller to use its synchronous fallback.
 */
export function createSearchPool(options: SearchPoolOptions): SearchPool {
  const graceMs = options.graceMs ?? DEFAULT_SEARCH_GRACE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_SEARCH_MAX_WAIT_MS;
  const startupMs = options.startupMs ?? DEFAULT_WORKER_STARTUP_MS;
  const workerUrl = options.workerUrl ?? DEFAULT_WORKER_URL;
  const slots: Slot[] = Array.from({ length: options.workers }, () => ({
    worker: null, ready: false, startupTimer: null, running: null,
  }));
  const queue: Waiting[] = [];
  const counters = { completed: 0, timeouts: 0, crashes: 0, failures: 0, rejected: 0 };
  const terminations: Promise<unknown>[] = [];
  let nextId = 1;
  let closed = false;

  function stats(): SearchPoolStats {
    return {
      alive: slots.filter((slot) => slot.worker).length,
      busy: slots.filter((slot) => slot.running).length,
      queued: queue.length,
      ...counters,
    };
  }

  function clearRunning(slot: Slot): Running | null {
    const running = slot.running;
    if (!running) return null;
    if (running.timer) clearTimeout(running.timer);
    slot.running = null;
    return running;
  }

  /** Stops the slot's worker for good; the next dispatch starts a new one. */
  function discard(slot: Slot): void {
    const worker = slot.worker;
    if (slot.startupTimer) clearTimeout(slot.startupTimer);
    slot.startupTimer = null;
    slot.worker = null;
    slot.ready = false;
    if (worker) {
      worker.removeAllListeners();
      // Swallow late errors from a worker that is already being torn down.
      worker.on('error', () => undefined);
      terminations.push(worker.terminate().catch(() => undefined));
    }
  }

  function finish(slot: Slot, outcome: SearchOutcome, discardWorker: boolean): void {
    const running = clearRunning(slot);
    if (discardWorker) discard(slot);
    running?.settle(outcome);
    dispatch();
  }

  function spawn(slot: Slot): void {
    const worker = new Worker(workerUrl, {
      // Do not inherit the host's loaders or debugger flags; the entry registers tsx itself.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: options.memoryMb },
    });
    worker.unref();
    slot.worker = worker;
    slot.ready = false;
    slot.startupTimer = setTimeout(() => {
      if (slot.worker !== worker) return;
      counters.crashes += 1;
      console.error('[bots] A search worker did not start in time.');
      finish(slot, { status: 'crashed', reason: 'The search worker did not start.' }, true);
    }, startupMs);
    slot.startupTimer.unref();
    worker.on('message', (message: WorkerMessage) => {
      if (slot.worker !== worker) return;
      if (message.type === 'ready') {
        slot.ready = true;
        if (slot.startupTimer) clearTimeout(slot.startupTimer);
        slot.startupTimer = null;
        if (slot.running) post(slot, slot.running);
        return;
      }
      const running = slot.running;
      if (!running || running.id !== message.id) return;
      if (message.type === 'result') {
        counters.completed += 1;
        finish(slot, { status: 'ok', action: message.action, elapsedMs: Date.now() - running.startedAt }, false);
      } else {
        counters.failures += 1;
        finish(slot, { status: 'failed', reason: message.reason }, false);
      }
    });
    const crashed = (reason: string): void => {
      if (slot.worker !== worker) return;
      counters.crashes += 1;
      console.error(`[bots] A search worker stopped unexpectedly: ${reason}`);
      // finish() also covers a worker that dies while idle: there is simply no task to settle.
      finish(slot, { status: 'crashed', reason }, true);
    };
    worker.on('error', (error) => crashed(error.message));
    worker.on('exit', (code) => crashed(`exit code ${code}`));
  }

  /** Starts the budget clock once the worker can actually receive the task. */
  function post(slot: Slot, running: Running): void {
    running.startedAt = Date.now();
    running.timer = setTimeout(() => {
      counters.timeouts += 1;
      finish(slot, { status: 'timeout', reason: `No result within ${running.task.budgetMs + graceMs} ms.` }, true);
    }, running.task.budgetMs + graceMs);
    running.timer.unref();
    const request: WorkerRequest = { id: running.id, task: running.task };
    slot.worker?.postMessage(request);
  }

  function dispatch(): void {
    if (closed) return;
    for (const slot of slots) {
      if (slot.running) continue;
      const waiting = queue.shift();
      if (!waiting) return;
      clearTimeout(waiting.waitTimer);
      const running: Running = { id: nextId, task: waiting.task, settle: waiting.settle, startedAt: Date.now(), timer: null };
      nextId += 1;
      slot.running = running;
      if (!slot.worker) spawn(slot);
      if (slot.ready) post(slot, running);
    }
  }

  function run(task: SearchTask, signal?: AbortSignal): Promise<SearchOutcome> {
    return new Promise<SearchOutcome>((resolve) => {
      const refuse = (status: 'rejected' | 'closed' | 'cancelled', reason: string): void => {
        if (status === 'rejected') counters.rejected += 1;
        resolve({ status, reason });
      };
      if (closed) return refuse('closed', 'The search pool is closed.');
      if (signal?.aborted) return refuse('cancelled', 'Cancelled before it started.');
      if (slots.length === 0) return refuse('rejected', 'The search pool has no workers.');
      if (queue.length >= options.queueLimit && slots.every((slot) => slot.running)) {
        return refuse('rejected', 'The search queue is full.');
      }
      const settle = (outcome: SearchOutcome): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      };
      const unqueue = (): boolean => {
        const index = queue.indexOf(entry);
        if (index < 0) return false;
        queue.splice(index, 1);
        clearTimeout(entry.waitTimer);
        return true;
      };
      function onAbort(): void {
        if (unqueue()) {
          settle({ status: 'cancelled', reason: 'Cancelled while waiting.' });
          return;
        }
        const slot = slots.find((candidate) => candidate.running?.settle === settle);
        if (slot) finish(slot, { status: 'cancelled', reason: 'Cancelled while searching.' }, true);
      }
      const waitTimer = setTimeout(() => {
        if (!unqueue()) return;
        counters.rejected += 1;
        settle({ status: 'rejected', reason: 'Waited too long for a free search worker.' });
      }, maxWaitMs);
      waitTimer.unref();
      const entry: Waiting = { task, settle, waitTimer };
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(entry);
      dispatch();
    });
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    for (const waiting of queue.splice(0)) {
      clearTimeout(waiting.waitTimer);
      waiting.settle({ status: 'closed', reason: 'The search pool is closed.' });
    }
    for (const slot of slots) {
      clearRunning(slot)?.settle({ status: 'closed', reason: 'The search pool is closed.' });
      discard(slot);
    }
    await Promise.all(terminations);
  }

  return { run, stats, close };
}
