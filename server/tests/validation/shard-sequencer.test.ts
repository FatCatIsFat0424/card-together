import { describe, expect, it } from 'vitest';
import { balanceShards, SLOW_TEST_FILES } from '../helpers/shard-sequencer';

describe('balanced test shards', () => {
  const light = Array.from({ length: 400 }, (_, index) => `tests/light/file-${index}.test.ts`);
  const files = [...light, ...Object.keys(SLOW_TEST_FILES)];
  const weight = (file: string): number => SLOW_TEST_FILES[file] ?? 1;

  it('assigns every file to exactly one shard', () => {
    const shards = balanceShards(files, (file) => file, 4);
    expect(shards.flat().sort()).toEqual([...files].sort());
  });

  it('keeps the estimated shard times close', () => {
    const totals = balanceShards(files, (file) => file, 4).map((shard) => shard.reduce((sum, file) => sum + weight(file), 0));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('does not depend on discovery order', () => {
    expect(balanceShards([...files].reverse(), (file) => file, 4)).toEqual(balanceShards(files, (file) => file, 4));
  });
});
