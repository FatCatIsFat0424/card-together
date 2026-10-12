import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { cpRankArrangements } from '@shared/rules/chinesepoker-arrange';
import { createDeck, shuffleDeck } from '../src/engine/deck';

function main(): void {
  let state = 23;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const hands = Array.from({ length: 21 }, () => shuffleDeck(createDeck(), random).slice(0, 13));
  cpRankArrangements(hands[0], 6);
  const times = hands.slice(1).map((hand) => {
    const started = performance.now();
    const result = cpRankArrangements(hand, 6);
    const elapsed = performance.now() - started;
    if (result.length !== 6 || !Number.isFinite(result[0].score)) throw new Error('Arrangement search failed.');
    return elapsed;
  });
  const averageMs = times.reduce((sum, time) => sum + time, 0) / times.length;
  const maximumMs = Math.max(...times);
  process.stdout.write(`${JSON.stringify({
    workload: 'chinesepoker-rank-six', seed: 23, warmup: 1, samples: times.length,
    node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
    averageMs, maximumMs, averageBudgetMs: 50, maximumBudgetMs: 200,
  })}\n`);
  if (averageMs >= 50 || maximumMs >= 200) throw new Error('Arrangement latency budget exceeded.');
}

try { main(); } catch (error: unknown) { console.error(error); process.exitCode = 1; }
