// Offline tuning of the chess and xiangqi bot evaluations (Texel method): self-play games with the bots' own
// search label positions with the final result, and logistic regression fits the evaluation weights to them.
//
//   npm run bots:tune -- selfplay --game chess --games 800 --out <file.jsonl> [--nodes 6000] [--parallel 4] [--seed 1]
//   npm run bots:tune -- fit --game chess --data <file.jsonl>[,<file.jsonl>] [--epochs 400] [--pull N] [--write]
//
// `fit --write` regenerates `server/src/bots/<game>-eval-weights.ts`; without it the fit only reports the loss.
// Self-play data stays outside the repository; the fitted weights are the committed output.

import { fork } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import { TUNING_GAMES } from './games';
import type { GameRecord, TuningGame, TuningGameName } from './games';

const USAGE = 'usage: bots:tune -- selfplay --game <chess|xiangqi> --games N --out FILE [--nodes N] [--parallel N] [--seed N]\n'
  + '       bots:tune -- fit --game <chess|xiangqi> --data FILE[,FILE] [--epochs N] [--pull N] [--write]';

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: readonly string[], name: string, fallback: number): number {
  const text = option(args, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) throw new Error(`--${name} must be a non-negative number.`);
  return value;
}

function gameOption(args: readonly string[]): TuningGameName {
  const name = option(args, 'game');
  if (name !== 'chess' && name !== 'xiangqi') throw new Error('--game must be chess or xiangqi.');
  return name;
}

// ─── Self-play ───

interface SelfPlayTask {
  readonly game: TuningGameName;
  readonly games: number;
  readonly nodes: number;
  readonly seed: number;
}

/** Random opening plies: enough variety that games do not repeat, few enough that most stay balanced. */
const randomPlies = (random: () => number): number => 4 + Math.floor(random() * 5);

function playShare(task: SelfPlayTask, onGame: (record: GameRecord) => void): void {
  const random = seededRandom(task.seed);
  for (let index = 0; index < task.games; index++) onGame(TUNING_GAMES[task.game].play(random, task.nodes, randomPlies(random)));
}

async function selfPlay(args: readonly string[]): Promise<void> {
  const game = gameOption(args);
  const games = numberOption(args, 'games', 100);
  const nodes = numberOption(args, 'nodes', 6_000);
  const parallel = Math.max(1, numberOption(args, 'parallel', 1));
  const seed = numberOption(args, 'seed', 1);
  const out = option(args, 'out');
  if (!out) throw new Error('--out is required.');
  let finished = 0;
  const record = (entry: GameRecord): void => {
    appendFileSync(out, `${JSON.stringify(entry)}\n`);
    finished++;
    process.stderr.write(`\r${finished}/${games} games`);
  };
  const shares = Array.from({ length: parallel }, (_, worker) => Math.floor(games / parallel) + (worker < games % parallel ? 1 : 0));
  await Promise.all(shares.map((count, worker) => new Promise<void>((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (message: GameRecord) => record(message));
    child.on('error', reject);
    child.on('exit', (code) => (code ? reject(new Error(`A self-play worker exited with code ${code}.`)) : resolve()));
    const task: SelfPlayTask = { game, games: count, nodes, seed: seed * 1_000 + worker };
    child.send(task);
  })));
  process.stderr.write('\n');
}

function runWorker(): void {
  process.once('message', (task: SelfPlayTask) => {
    playShare(task, (record) => process.send?.(record));
    process.disconnect();
  });
}

// ─── Fit ───

/** Sparse trace of one quiet position. */
interface Sample {
  readonly indices: Int32Array;
  readonly counts: Float64Array;
  /** Middlegame and endgame shares of each count after tapering and scaling. */
  readonly middle: number;
  readonly end: number;
  readonly extra: number;
  readonly result: number;
}

/** Every tenth game is held out to check that the fit generalizes. */
const HOLD_OUT = 10;

function loadSamples(game: TuningGame, files: readonly string[]): { training: Sample[]; validation: Sample[] } {
  const seen = new Set<string>();
  const training: Sample[] = [];
  const validation: Sample[] = [];
  const trace = new Float64Array(game.traceSize);
  let games = 0;
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as GameRecord;
      const samples = games++ % HOLD_OUT === 0 ? validation : training;
      for (const position of record.positions) {
        if (seen.has(position)) continue;
        seen.add(position);
        if (!game.trace(position, trace)) continue;
        const indices: number[] = [];
        const counts: number[] = [];
        for (let index = 0; index < game.parameters; index++) {
          if (trace[index] !== 0) {
            indices.push(index);
            counts.push(trace[index]);
          }
        }
        const phase = trace[game.phaseSlot];
        samples.push({
          indices: Int32Array.from(indices), counts: Float64Array.from(counts),
          middle: phase / game.maxPhase, end: (game.maxPhase - phase) / game.maxPhase * trace[game.scaleSlot] / 128,
          extra: trace[game.extraSlot], result: record.result,
        });
      }
    }
  }
  return { training, validation };
}

function evaluate(sample: Sample, weights: Float64Array): number {
  let middle = 0;
  let end = 0;
  for (let index = 0; index < sample.indices.length; index++) {
    const parameter = sample.indices[index];
    middle += weights[parameter * 2] * sample.counts[index];
    end += weights[parameter * 2 + 1] * sample.counts[index];
  }
  return middle * sample.middle + end * sample.end + sample.extra;
}

const sigmoid = (score: number, scale: number): number => 1 / (1 + Math.exp(-scale * score));

function meanError(samples: readonly Sample[], weights: Float64Array, scale: number): number {
  let total = 0;
  for (const sample of samples) total += (sigmoid(evaluate(sample, weights), scale) - sample.result) ** 2;
  return total / samples.length;
}

/** The logistic scale that best maps the current scores to results (golden-section search). */
function fitScale(samples: readonly Sample[], weights: Float64Array): number {
  let low = 0.0005;
  let high = 0.02;
  for (let step = 0; step < 40; step++) {
    const a = low + (high - low) * 0.382;
    const b = low + (high - low) * 0.618;
    if (meanError(samples, weights, a) < meanError(samples, weights, b)) high = b;
    else low = a;
  }
  return (low + high) / 2;
}

/**
 * Adam on the mean squared error plus an L2 pull towards the starting weights; returns the weights with the lowest
 * held-out error seen.
 */
function fit(
  samples: readonly Sample[], validation: readonly Sample[], start: readonly number[], scale: number, epochs: number,
  pull: number, fixed: ReadonlySet<number>,
): Float64Array {
  const weights = Float64Array.from(start);
  let best = Float64Array.from(start);
  let bestError = meanError(validation, weights, scale);
  const gradient = new Float64Array(weights.length);
  const first = new Float64Array(weights.length);
  const second = new Float64Array(weights.length);
  const rate = 1;
  for (let epoch = 1; epoch <= epochs; epoch++) {
    gradient.fill(0);
    for (const sample of samples) {
      const predicted = sigmoid(evaluate(sample, weights), scale);
      // d(error)/d(score) for the squared error of the sigmoid.
      const slope = 2 * (predicted - sample.result) * scale * predicted * (1 - predicted) / samples.length;
      for (let index = 0; index < sample.indices.length; index++) {
        const parameter = sample.indices[index];
        gradient[parameter * 2] += slope * sample.counts[index] * sample.middle;
        gradient[parameter * 2 + 1] += slope * sample.counts[index] * sample.end;
      }
    }
    for (let index = 0; index < weights.length; index++) {
      if (fixed.has(index)) continue;
      const step = gradient[index] + 2 * pull * (weights[index] - start[index]);
      first[index] = 0.9 * first[index] + 0.1 * step;
      second[index] = 0.999 * second[index] + 0.001 * step * step;
      const corrected = first[index] / (1 - 0.9 ** epoch);
      const spread = second[index] / (1 - 0.999 ** epoch);
      weights[index] -= rate * corrected / (Math.sqrt(spread) + 1e-12);
    }
    if (epoch % 10 === 0) {
      const error = meanError(validation, weights, scale);
      if (error < bestError) {
        bestError = error;
        best = Float64Array.from(weights);
      }
      if (epoch % 50 === 0) {
        process.stderr.write(`epoch ${epoch}: training ${meanError(samples, weights, scale).toFixed(6)}, held out ${error.toFixed(6)}\n`);
      }
    }
  }
  return best;
}

function writeWeights(game: TuningGame, weights: readonly number[]): void {
  const rows: string[] = [];
  for (let index = 0; index < weights.length; index += 16) {
    rows.push(`  ${weights.slice(index, index + 16).map((value) => Math.round(value)).join(', ')},`);
  }
  writeFileSync(game.weightsPath, `// Generated by \`npm run bots:tune -- fit --game ${game.weightsGame} --write\`; do not edit by hand. Empty means the
// hand-set weights apply.

/** Tuned evaluation weights, \`[mg0, eg0, mg1, eg1, …]\` in the layout of \`${game.weightsGame}-eval.ts\`. */
export const ${game.weightsExport}: readonly number[] = [
${rows.join('\n')}
];
`);
}

function runFit(args: readonly string[]): void {
  const name = gameOption(args);
  const game = TUNING_GAMES[name];
  const files = (option(args, 'data') ?? '').split(',').filter(Boolean);
  if (files.length === 0) throw new Error('--data is required.');
  const epochs = numberOption(args, 'epochs', 400);
  const start = game.activeWeights();
  game.setWeights(start);
  const { training, validation } = loadSamples(game, files);
  process.stderr.write(`${training.length} quiet positions, ${validation.length} held out\n`);
  const startWeights = Float64Array.from(start);
  const scale = fitScale(training, startWeights);
  const before = meanError(validation, startWeights, scale);
  process.stderr.write(`scale ${scale.toFixed(6)}, held-out error ${before.toFixed(6)}\n`);
  // Material of a xiangqi general carries no meaning; everything else is free.
  const fixed = new Set<number>(name === 'xiangqi' ? [0, 1] : []);
  const tuned = fit(training, validation, start, scale, epochs, numberOption(args, 'pull', game.pull), fixed);
  const after = meanError(validation, tuned, scale);
  process.stderr.write(`held-out error ${before.toFixed(6)} -> ${after.toFixed(6)}\n`);
  if (args.includes('--write')) {
    writeWeights(game, Array.from(tuned));
    process.stderr.write(`wrote ${game.weightsPath}\n`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'selfplay') await selfPlay(args);
  else if (command === 'fit') runFit(args);
  else throw new Error('Unknown command.');
}

if (process.argv.includes('--worker')) {
  runWorker();
} else {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    process.exitCode = 1;
  });
}
