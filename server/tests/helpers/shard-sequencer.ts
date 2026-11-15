import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { BaseSequencer } from 'vitest/node';
import type { TestSpecification } from 'vitest/node';

/**
 * Approximate seconds of the test files that dominate the suite, relative to `server/`; every other file counts as
 * one second. Vitest's own sharding splits by path hash, which put most of these into the same CI shard.
 * Refresh the numbers when a slow suite changes noticeably (`npx vitest run --reporter=json`).
 */
export const SLOW_TEST_FILES: Readonly<Record<string, number>> = {
  'tests/runtime/match-replay-json.test.ts': 90,
  'tests/runtime/match-replay-sqlite.test.ts': 90,
  'tests/runtime/match-replay-spades-json.test.ts': 75,
  'tests/runtime/match-replay-spades-sqlite.test.ts': 75,
  'tests/runtime/match-replay-hearts-json.test.ts': 55,
  'tests/runtime/match-replay-hearts-sqlite.test.ts': 55,
  'tests/database/game-stats.test.ts': 40,
  'tests/runtime/match-replay-chinesecheckers-json.test.ts': 35,
  'tests/runtime/match-replay-chinesecheckers-sqlite.test.ts': 35,
};

/** Splits files into `count` shards of similar estimated time, heaviest first; ties follow the path hash so the result is stable. */
export function balanceShards<T>(files: readonly T[], path: (file: T) => string, count: number): T[][] {
  const ordered = files.map((file) => ({
    file, weight: SLOW_TEST_FILES[path(file)] ?? 1, hash: createHash('sha1').update(path(file)).digest('hex'),
  })).sort((a, b) => b.weight - a.weight || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ weight: 0, files: [] as T[] }));
  for (const item of ordered) {
    const lightest = shards.reduce((best, shard) => shard.weight < best.weight ? shard : best);
    lightest.files.push(item.file);
    lightest.weight += item.weight;
  }
  return shards.map((shard) => shard.files);
}

export class BalancedShardSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return files;
    const path = (spec: TestSpecification): string => relative(root, spec.moduleId).replaceAll('\\', '/');
    return balanceShards(files, path, shard.count)[shard.index - 1] ?? [];
  }
}
