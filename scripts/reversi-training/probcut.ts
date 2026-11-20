// Calibrates the Reversi bot's Multi-ProbCut (server/src/bots/reversi-probcut.ts): for sampled self-play
// positions, compares full-width search values at every depth with the shallow depth the engine uses for it,
// and fits deep ≈ slope × shallow + intercept with the residual standard deviation, per depth and game stage.
// Run after `npm run reversi:train` (it reads the cached self-play positions and the fitted weights).
// Usage: npm run reversi:probcut -- [--positions 1200] [--max-depth 11] [--workers 4] [--dir <cache>]
import { fork } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bitboards } from '../../server/src/bots/reversi-board';
import { emptiesOf, probCutShallowDepth, searchScore } from '../../server/src/bots/reversi-engine';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import { RECORD_INTS } from './selfplay';

const BUCKETS = 5;
const BUCKET_WIDTH = 10;
const MIN_DEPTH = 3;
const OUTPUT = fileURLToPath(new URL('../../server/src/bots/reversi-probcut.ts', import.meta.url));

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/** Worker: full-width values at depths 0..max for each position it receives. */
function runWorker(): void {
  const maxDepth = Number(option('max-depth', '11'));
  process.on('message', ({ id, board }: { id: number; board: Bitboards }) => {
    const values: number[] = [];
    for (let depth = 0; depth <= maxDepth; depth++) values.push(searchScore(board, depth, 18, false));
    process.send!({ id, values });
  });
}

function samplePositions(dir: string, count: number): Bitboards[] {
  const random = seededRandom(7);
  const files = readdirSync(dir).filter((name) => /^round\d+-\d+\.bin$/.test(name)).sort();
  const pool: Bitboards[] = [];
  for (const name of files) {
    const bytes = readFileSync(join(dir, name));
    const records = new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    for (let k = 0; k < records.length; k += RECORD_INTS) {
      if (random() > 0.01) continue;
      const board = { pl: records[k], ph: records[k + 1], ol: records[k + 2], oh: records[k + 3] };
      if (emptiesOf(board) >= 14) pool.push(board);
    }
  }
  // Even coverage of the stages: take the same number from each bucket.
  const perBucket = Math.ceil(count / BUCKETS);
  const chosen: Bitboards[] = [];
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    chosen.push(...pool.filter((board) => bucketOf(emptiesOf(board)) === bucket).slice(0, perBucket));
  }
  return chosen;
}

const bucketOf = (empties: number): number => Math.min(BUCKETS - 1, Math.floor((60 - empties) / BUCKET_WIDTH));

async function main(): Promise<void> {
  const dir = option('dir', join(fileURLToPath(new URL('../../node_modules/.cache/reversi-training', import.meta.url))));
  const maxDepth = Number(option('max-depth', '11'));
  const workers = Number(option('workers', '4'));
  const positions = samplePositions(dir, Number(option('positions', '1200')));
  console.error(`calibrating on ${positions.length} positions up to depth ${maxDepth}`);
  const pool = Array.from({ length: workers }, () => fork(fileURLToPath(import.meta.url), ['--worker', '--max-depth', String(maxDepth)], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  }));
  const values: number[][] = new Array<number[]>(positions.length);
  let next = 0;
  let done = 0;
  await new Promise<void>((resolve) => {
    const feed = (child: (typeof pool)[number]): void => {
      if (next >= positions.length) return;
      const id = next++;
      child.send({ id, board: positions[id] });
    };
    for (const child of pool) {
      child.on('message', ({ id, values: result }: { id: number; values: number[] }) => {
        values[id] = result;
        done++;
        if (done % 100 === 0) console.error(`  ${done} / ${positions.length}`);
        if (done === positions.length) resolve();
        else feed(child);
      });
      feed(child);
    }
  });
  for (const child of pool) child.kill();

  const table: number[] = [];
  const lines: string[] = [];
  for (let bucket = 0; bucket < BUCKETS; bucket++) {
    for (let depth = 0; depth <= maxDepth; depth++) {
      if (depth < MIN_DEPTH) {
        table.push(1, 0, 0);
        continue;
      }
      const shallow = probCutShallowDepth(depth);
      const pairs = positions.flatMap((board, k) => (bucketOf(emptiesOf(board)) === bucket ? [[values[k][shallow], values[k][depth]]] : []));
      const n = pairs.length;
      const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
      const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
      const sxx = pairs.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
      const sxy = pairs.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
      const slope = Math.min(1.5, Math.max(0.5, sxy / sxx));
      const intercept = meanY - slope * meanX;
      const deviation = Math.sqrt(pairs.reduce((sum, [x, y]) => sum + (y - slope * x - intercept) ** 2, 0) / Math.max(1, n - 2));
      table.push(Number(slope.toFixed(3)), Number(intercept.toFixed(1)), Number(deviation.toFixed(1)));
      lines.push(`bucket ${bucket} depth ${depth} (from ${shallow}): slope ${slope.toFixed(3)} intercept ${intercept.toFixed(1)} sd ${deviation.toFixed(1)} (n ${n})`);
    }
  }
  console.error(lines.join('\n'));
  const rows = Array.from({ length: BUCKETS }, (_, bucket) => `  ${table.slice(bucket * (maxDepth + 1) * 3, (bucket + 1) * (maxDepth + 1) * 3).join(', ')},`);
  const output = option('out', OUTPUT);
  writeFileSync(output, `// Written by \`npm run reversi:probcut\` (scripts/reversi-training/probcut.ts); do not edit by hand.

/** Deep searches from this depth try a shallow search first. */
export const PROBCUT_MIN_DEPTH = ${MIN_DEPTH};
/** Deeper searches reuse the parameters of this depth. */
export const PROBCUT_MAX_DEPTH = ${maxDepth};
/** Game stages by empty squares: bucket \`min(BUCKETS - 1, floor((60 - empties) / WIDTH))\`. */
export const PROBCUT_BUCKETS = ${BUCKETS};
export const PROBCUT_BUCKET_WIDTH = ${BUCKET_WIDTH};
/** Per bucket and depth 0..MAX: slope, intercept, and residual deviation (score units) of deep on shallow. */
export const PROBCUT: readonly number[] = [
${rows.join('\n')}
];
`);
  console.error(`wrote ${output}`);
}

if (process.argv.includes('--worker')) runWorker();
else {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
