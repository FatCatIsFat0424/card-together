// Fits the Reversi bot's pattern evaluation by rounds of self-play and writes server/src/bots/reversi-weights.bin.
// Usage: npm run reversi:train -- [--rounds 7] [--games 24000] [--workers 6] [--epochs 6] [--blend-from 4]
//   [--seed 1] [--dir <cache>]
//
// Round 1 plays with hand-made weights (bootstrap.ts); every later round plays with the previous round's fit
// and refits on the positions of all rounds so far. From round --blend-from on, positions keep their search
// score and the fit blends it with the game result. Games and intermediate weights are cached in --dir
// (default node_modules/.cache/reversi-training); shards already there are not replayed, and a round's weights are
// not refitted once the next round has been played with them, so an interrupted or extended run resumes.
import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { REVERSI_WEIGHTS_PATH, decodeWeights, encodeWeights, useEvaluationWeights } from '../../server/src/bots/reversi-eval';
import { bootstrapWeights } from './bootstrap';
import { fitWeights } from './fit';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import { RECORD_INTS, selfPlayGame } from './selfplay';

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const gzip = (data: Uint8Array): Uint8Array => gzipSync(data, { level: 9 });

/** Worker: plays `--games` games with the given weights and writes their records to `--out`. */
function runWorker(): void {
  const weightsPath = option('weights', 'bootstrap');
  useEvaluationWeights(weightsPath === 'bootstrap' ? bootstrapWeights() : decodeWeights(readFileSync(weightsPath)));
  const games = Number(option('games', '0'));
  const keepScores = option('keep-scores', '0') === '1';
  const random = seededRandom(Number(option('seed', '1')));
  const records: number[] = [];
  for (let game = 0; game < games; game++) {
    const depth = 3 + Math.floor(random() * 3);
    const other = Math.max(2, depth + Math.floor(random() * 3) - 1);
    const depths: [number, number] = random() < 0.5 ? [depth, other] : [other, depth];
    // Mostly short random openings, sometimes long ones for unusual positions.
    const openingMoves = random() < 0.8 ? 2 + Math.floor(random() * 10) : 12 + Math.floor(random() * 16);
    for (const value of selfPlayGame({ random, depths, openingMoves, keepScores })) records.push(value);
  }
  writeFileSync(option('out', ''), new Uint8Array(Int32Array.from(records).buffer));
}

interface RoundOptions {
  readonly dir: string;
  readonly round: number;
  readonly weights: string;
  readonly games: number;
  readonly workers: number;
  readonly seed: number;
  readonly keepScores: boolean;
}

async function generateRound({ dir, round, weights, games, workers, seed, keepScores }: RoundOptions): Promise<void> {
  const shards = Array.from({ length: workers }, (_, shard) => join(dir, `round${round}-${shard}.bin`));
  const missing = shards.flatMap((out, shard) => (existsSync(out) ? [] : [{ out, shard }]));
  if (missing.length === 0) {
    console.error(`round ${round}: reusing cached games`);
    return;
  }
  const started = Date.now();
  await Promise.all(missing.map(({ out, shard }) => new Promise<void>((resolve, reject) => {
    const share = Math.floor(games / workers) + (shard < games % workers ? 1 : 0);
    const child = fork(fileURLToPath(import.meta.url), [
      '--worker', '--weights', weights, '--games', String(share), '--seed', String(seed * 1000 + round * 100 + shard), '--out', out,
      '--keep-scores', keepScores ? '1' : '0',
    ], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`self-play worker exited with ${code}`))));
  })));
  console.error(`round ${round}: ${games} games in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

function loadRecords(dir: string, rounds: number, workers: number): Int32Array {
  const parts: Int32Array[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let shard = 0; shard < workers; shard++) {
      const bytes = readFileSync(join(dir, `round${round}-${shard}.bin`));
      parts.push(new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
    }
  }
  const all = new Int32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

async function main(): Promise<void> {
  const rounds = Number(option('rounds', '7'));
  const games = Number(option('games', '24000'));
  const workers = Number(option('workers', '6'));
  const blendFrom = Number(option('blend-from', '4'));
  const epochs = Number(option('epochs', '6'));
  const seed = Number(option('seed', '1'));
  const dir = option('dir', join(fileURLToPath(new URL('../../node_modules/.cache/reversi-training', import.meta.url))));
  mkdirSync(dir, { recursive: true });
  let weights = 'bootstrap';
  for (let round = 1; round <= rounds; round++) {
    await generateRound({ dir, round, weights, games, workers, seed, keepScores: round >= blendFrom });
    const cached = join(dir, `weights${round}.bin`);
    const nextPlayed = Array.from({ length: workers }, (_, shard) => join(dir, `round${round + 1}-${shard}.bin`)).every(existsSync);
    if (round < rounds && nextPlayed && existsSync(cached)) {
      // The next round's games were played with these weights; keep them consistent.
      console.error(`round ${round}: reusing cached weights`);
      weights = cached;
      continue;
    }
    const records = loadRecords(dir, round, workers);
    console.error(`round ${round}: fitting ${records.length / RECORD_INTS} positions`);
    const fitted = fitWeights(records, { epochs, random: seededRandom(seed + round), log: (line) => console.error(`  ${line}`) });
    const encoded = encodeWeights(fitted, gzip);
    weights = join(dir, `weights${round}.bin`);
    writeFileSync(weights, encoded);
    if (round === rounds) {
      writeFileSync(REVERSI_WEIGHTS_PATH, encoded);
      console.error(`wrote ${encoded.length} bytes to ${REVERSI_WEIGHTS_PATH}`);
    }
  }
}

if (process.argv.includes('--worker')) runWorker();
else {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
