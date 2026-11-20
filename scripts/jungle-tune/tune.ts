// Offline tuning of the Jungle evaluation weights by self-play. Usage:
//   tsx --tsconfig server/tsconfig.json scripts/jungle-tune/tune.ts tune  [--iterations 300] [--pairs 12] [--nodes 20000] [--parallel 3] [--seed 1] [--out <file>]
//   tsx --tsconfig server/tsconfig.json scripts/jungle-tune/tune.ts match [--a <json>] [--b <json>] [--pairs 100] [--nodes 20000 | --ms 50] [--parallel 3]
//
// `tune` runs head-to-head SPSA: each iteration plays two perturbed weight vectors against each other from random
// openings, every opening twice with the colours exchanged, at a fixed node budget so results do not depend on the
// machine's load. The final vector is printed in the layout of server/src/bots/jungle-weights.ts. `match` compares
// two vectors (defaults to the committed weights; a JSON file holds an array of numbers) the same way and reports
// the score and a sign test over the duplicate pairs.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { jgApply, jgInitialCells, jgLegalMoves, jgOpponent, jgOutcome } from '@shared/rules/jungle';
import type { JgMove, JgSide } from '@shared/rules/jungle';
import { W } from '../../server/src/bots/jungle-eval';
import { searchBestMove } from '../../server/src/bots/jungle-search';
import { JUNGLE_WEIGHTS } from '../../server/src/bots/jungle-weights';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import { forkPool, serveJobs } from '../bot-tune/pool';
import { spsa } from '../bot-tune/spsa';
import type { TuneParam } from '../bot-tune/spsa';

const ENTRY = fileURLToPath(import.meta.url);
const log = (text: string): void => { process.stdout.write(`${text}\n`); };
const MAX_PLIES = 400;
const OPENING_PLIES = 4;

interface Job {
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly seed: number;
  /** Nodes per move; 0 to use `ms` instead */
  readonly nodes: number;
  readonly ms: number;
}

/** The winning side of one game from the opening, or -1 for a draw. */
function playGame(opening: readonly JgMove[], weights: readonly [Float64Array, Float64Array], job: Job, random: () => number): number {
  let cells: number[] = jgInitialCells();
  let side: JgSide = 0;
  let quiet = 0;
  let past: number[][] = [];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    let move: JgMove | null;
    if (ply < opening.length) move = opening[ply];
    else {
      const deadline = performance.now() + job.ms;
      move = searchBestMove(cells, side, {
        maxDepth: 40, expired: job.nodes > 0 ? () => false : () => performance.now() >= deadline, random, quiet, history: past,
        weights: weights[side], maxNodes: job.nodes > 0 ? job.nodes : Infinity, tableBits: job.nodes > 0 && job.nodes < 100_000 ? 16 : 20,
      });
    }
    if (move === null) return jgOpponent(side);
    const capture = cells[move.to] !== 0;
    const next = jgApply(cells, move);
    quiet = capture ? 0 : quiet + 1;
    const outcome = jgOutcome(next, side, move.to, quiet);
    if (outcome) return outcome.winner ?? -1;
    past = capture ? [] : [...past, cells];
    cells = next;
    side = jgOpponent(side);
  }
  return -1;
}

/** Points of the first weights over the two games of one opening: 0 to 2, a draw being half a point each. */
function playPair(job: Job): number {
  const random = seededRandom(job.seed);
  const opening: JgMove[] = [];
  let cells = jgInitialCells();
  let side: JgSide = 0;
  for (let ply = 0; ply < OPENING_PLIES; ply++) {
    const moves = jgLegalMoves(cells, side);
    const move = moves[Math.floor(random() * moves.length)];
    opening.push(move);
    cells = jgApply(cells, move);
    side = jgOpponent(side);
  }
  const a = Float64Array.from(job.a);
  const b = Float64Array.from(job.b);
  const first = playGame(opening, [a, b], job, random);
  const second = playGame(opening, [b, a], job, random);
  const points = (winner: number, aSide: number): number => (winner < 0 ? 0.5 : winner === aSide ? 1 : 0);
  return points(first, 0) + points(second, 1);
}

/** The slots of the weight vector, with the starting value, perturbation size, and bounds of the tunable ones. */
function parameters(start: readonly number[]): TuneParam[] {
  const names = [
    ...['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'].map((animal) => `material ${animal}`),
    ...['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'].map((animal) => `advance ${animal}`),
    'trapped %', 'rat hunt', 'elephant fear', 'elephant near',
    ...[1, 2, 3, 4, 5, 6].map((moves) => `race ${moves}`),
    'cover', 'mobility', 'tempo', 'endgame %', 'noise', 'fade from',
  ];
  const fixed = new Set([W.MOBILITY, W.NOISE, W.FADE_FROM]);
  return names.map((name, index) => {
    const material = index < 8;
    const advance = index >= 8 && index < 16;
    const race = index >= W.RACE && index < W.RACE + 6;
    return {
      name, value: start[index], fixed: fixed.has(index as never),
      step: material ? 40 : advance ? 1.5 : race ? 150 : 15, min: advance ? 0 : race ? 0 : material ? 50 : 0,
      max: material ? 1500 : advance ? 30 : race ? 20_000 : 600,
    };
  });
}

const format = (values: readonly number[]): string => values.map((value) => Math.round(value * 10) / 10).join(', ');

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      iterations: { type: 'string' }, pairs: { type: 'string' }, nodes: { type: 'string' }, ms: { type: 'string' },
      parallel: { type: 'string' }, seed: { type: 'string' }, out: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' },
      start: { type: 'string' }, rate: { type: 'string' },
    },
  });
  const mode = positionals[0];
  const pairs = Number(values.pairs ?? (mode === 'tune' ? 12 : 100));
  const ms = Number(values.ms ?? 0);
  const nodes = ms > 0 ? 0 : Number(values.nodes ?? 20_000);
  const seed = Number(values.seed ?? 1);
  const pool = forkPool<Job, number>(ENTRY, Number(values.parallel ?? 3));
  const load = (path: string | undefined): number[] => (path ? JSON.parse(readFileSync(path, 'utf8')) as number[] : [...JUNGLE_WEIGHTS]);
  try {
    if (mode === 'match') {
      const a = load(values.a);
      const b = load(values.b);
      const results = await pool.map(Array.from({ length: pairs }, (_, pair): Job => ({ a, b, seed: seed * 100_003 + pair, nodes, ms })));
      const total = results.reduce((sum, points) => sum + points, 0);
      const aheadA = results.filter((points) => points > 1).length;
      const aheadB = results.filter((points) => points < 1).length;
      log(`A scored ${total}/${pairs * 2} (${((100 * total) / (pairs * 2)).toFixed(1)}%); pairs A ${aheadA}, B ${aheadB}, level ${pairs - aheadA - aheadB}`);
    } else if (mode === 'tune') {
      const iterations = Number(values.iterations ?? 300);
      const rng = seededRandom(seed);
      const params = parameters(load(values.start));
      let counter = 0;
      const tuned = await spsa(params, {
        iterations, random: rng, rate: Number(values.rate ?? 24),
        play: async (plus, minus) => {
          const batch = Array.from({ length: pairs }, (): Job => ({ a: plus, b: minus, seed: seed * 1_000_003 + counter++, nodes, ms }));
          const results = await pool.map(batch);
          return (results.reduce((sum, points) => sum + points, 0) - pairs) / pairs;
        },
        onIteration: (iteration, theta, score) => {
          if ((iteration + 1) % 10 === 0) log(`#${iteration + 1} score ${score.toFixed(2)} [${format(theta)}]`);
          if (values.out) writeFileSync(values.out, JSON.stringify(theta.map((value) => Math.round(value * 10) / 10)));
        },
      });
      log(`tuned: [${format(tuned)}]`);
    } else throw new Error('Usage: tune.ts tune|match [options]');
  } finally {
    pool.close();
  }
}

if (process.argv.includes('--worker')) serveJobs(playPair);
else void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
