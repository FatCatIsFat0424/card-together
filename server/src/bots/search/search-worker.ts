import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { seededRandom } from './seeded-random';
import type { SearchContext, SearchStrategy, SearchStrategyRef, WorkerMessage, WorkerRequest } from './search-types';

const port = parentPort;
if (!port) throw new Error('The search worker must run inside a worker thread.');

const strategies = new Map<string, SearchStrategy>();

async function loadStrategy(ref: SearchStrategyRef): Promise<SearchStrategy> {
  const key = `${ref.module}#${ref.exportName}`;
  const cached = strategies.get(key);
  if (cached) return cached;
  const exported: unknown = ((await import(ref.module)) as Record<string, unknown>)[ref.exportName];
  if (typeof exported !== 'function') throw new Error(`Search strategy ${key} is not a function.`);
  const strategy = exported as SearchStrategy;
  strategies.set(key, strategy);
  return strategy;
}

function post(message: WorkerMessage): void {
  port?.postMessage(message);
}

port.on('message', (request: WorkerRequest) => {
  void (async (): Promise<void> => {
    const { id, task } = request;
    try {
      const strategy = await loadStrategy(task.strategy);
      // The budget starts when the strategy does, so loading its module is not charged to it.
      const deadline = performance.now() + task.budgetMs;
      const context: SearchContext = {
        random: seededRandom(task.seed),
        budget: {
          maxDepth: task.maxDepth,
          timeLeftMs: () => Math.max(0, deadline - performance.now()),
          expired: () => performance.now() >= deadline,
        },
      };
      post({ type: 'result', id, action: strategy(task.visible as never, context) });
    } catch (error) {
      post({ type: 'error', id, reason: error instanceof Error ? error.message : String(error) });
    }
  })();
});

post({ type: 'ready' });
