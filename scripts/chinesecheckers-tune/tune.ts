// Offline tuning of the Chinese checkers evaluation weights by self-play. Usage:
//   tsx --tsconfig server/tsconfig.json scripts/chinesecheckers-tune/tune.ts tune  [--iterations 100] [--pairs 8] [--nodes 5000] [--players 2,4] [--parallel 3] [--seed 1] [--out <file>]
//   tsx --tsconfig server/tsconfig.json scripts/chinesecheckers-tune/tune.ts match [--a <json>] [--b <json>] [--pairs 40] [--nodes 5000] [--players 2,4]
//
// Seats alternate between the two weight vectors and every opening is played twice with the vectors exchanged, at a
// fixed node budget per move so results do not depend on the machine's load. `tune` runs head-to-head SPSA and
// prints the final vector in the layout of server/src/bots/chinesecheckers-weights.ts; `match` compares two
// vectors (defaults to the committed weights; a JSON file holds an array of numbers).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  CC_TURN_LIMIT, ccApply, ccCorners, ccFinished, ccInitialHoles, ccRemaining,
} from '@shared/rules/chinesecheckers';
import type { CcHole } from '@shared/rules/chinesecheckers';
import { searchBestMove, searchBoard } from '../../server/src/bots/chinesecheckers-search';
import { CHINESE_CHECKERS_WEIGHTS } from '../../server/src/bots/chinesecheckers-weights';
import { seededRandom } from '../../server/src/bots/search/seeded-random';
import { forkPool, serveJobs } from '../bot-tune/pool';
import { spsa } from '../bot-tune/spsa';
import type { TuneParam } from '../bot-tune/spsa';

const ENTRY = fileURLToPath(import.meta.url);
const log = (text: string): void => { process.stdout.write(`${text}\n`); };

interface Job {
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly players: number;
  readonly seed: number;
  readonly nodes: number;
}

/** Index of the winning seat, a list of tied seats at the turn limit, or an empty list for a stalled game. */
function playGame(weights: readonly Float64Array[], players: number, job: Job, random: () => number): readonly number[] {
  const corners = ccCorners(players)!;
  let holes: CcHole[] = ccInitialHoles(corners);
  const turns = new Array<number>(players).fill(0);
  for (let seat = 0; ; seat = (seat + 1) % players) {
    if (turns[seat] >= CC_TURN_LIMIT) break;
    const corner = corners[seat];
    const opponents = Array.from({ length: players - 1 }, (_, step) => corners[(seat + step + 1) % players]);
    const move = searchBestMove(searchBoard(holes), corner, {
      previous: null, opponents, expired: () => false, random, maxNodes: job.nodes, weights: weights[seat % 2], tableBits: 16,
      turnsLeft: CC_TURN_LIMIT - turns[seat],
    });
    turns[seat]++;
    if (!move) continue;
    holes = ccApply(holes, move.from, move.to);
    // The mover wins by finishing; a marble dropped into a rival's last hole hands that rival the win.
    for (let step = 0; step < players; step++) {
      const other = (seat + step) % players;
      if (ccFinished(holes, corners[other])) return [other];
    }
  }
  const left = corners.map((corner) => ccRemaining(holes, corner));
  const best = Math.min(...left);
  return left.flatMap((value, seat) => (value === best ? [seat] : []));
}

/** Points of the first weights over the two games of one opening: 0 to 2. */
function playPair(job: Job): number {
  const random = seededRandom(job.seed);
  const a = Float64Array.from(job.a);
  const b = Float64Array.from(job.b);
  let points = 0;
  // Seat parity decides the weights; the second game exchanges them.
  for (const weights of [[a, b], [b, a]]) {
    const winners = playGame(weights, job.players, job, random);
    const share = winners.filter((seat) => weights[seat % 2] === a).length / winners.length;
    points += share;
  }
  return points;
}

const NAMES = ['straggler', 'drift', 'hop', 'cohesion', 'order cohesion', 'backtrack', 'noise', 'follow-up'];

function parameters(start: readonly number[]): TuneParam[] {
  const steps = [0.015, 0.06, 0.15, 0.08, 0.1, 0.3, 0.01, 0.2];
  return NAMES.map((name, index) => ({
    name, value: start[index], step: steps[index], min: 0, max: index === 1 ? 1 : 3, fixed: name === 'noise' || name === 'backtrack',
  }));
}

const format = (values: readonly number[]): string => values.map((value) => Math.round(value * 1000) / 1000).join(', ');

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      iterations: { type: 'string' }, pairs: { type: 'string' }, nodes: { type: 'string' }, players: { type: 'string' },
      parallel: { type: 'string' }, seed: { type: 'string' }, out: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' },
      start: { type: 'string' }, rate: { type: 'string' },
    },
  });
  const mode = positionals[0];
  const pairs = Number(values.pairs ?? (mode === 'tune' ? 8 : 40));
  const nodes = Number(values.nodes ?? 5000);
  const seed = Number(values.seed ?? 1);
  const counts = (values.players ?? '2,4').split(',').map(Number);
  const pool = forkPool<Job, number>(ENTRY, Number(values.parallel ?? 3));
  const load = (path: string | undefined): number[] => (path ? JSON.parse(readFileSync(path, 'utf8')) as number[] : [...CHINESE_CHECKERS_WEIGHTS]);
  const batch = (a: readonly number[], b: readonly number[], first: number): Job[] =>
    Array.from({ length: pairs }, (_, index) => ({ a, b, players: counts[index % counts.length], seed: seed * 1_000_003 + first + index, nodes }));
  try {
    if (mode === 'match') {
      const results = await pool.map(batch(load(values.a), load(values.b), 0));
      const total = results.reduce((sum, points) => sum + points, 0);
      for (const count of counts) {
        const mine = results.filter((_, index) => counts[index % counts.length] === count);
        log(`${count} players: A scored ${mine.reduce((sum, points) => sum + points, 0)}/${mine.length * 2}`);
      }
      log(`A scored ${total}/${pairs * 2} (${((100 * total) / (pairs * 2)).toFixed(1)}%)`);
    } else if (mode === 'tune') {
      let counter = 0;
      const tuned = await spsa(parameters(load(values.start)), {
        iterations: Number(values.iterations ?? 100), random: seededRandom(seed), rate: Number(values.rate ?? 24),
        play: async (plus, minus) => {
          const results = await pool.map(batch(plus, minus, counter));
          counter += pairs;
          return (results.reduce((sum, points) => sum + points, 0) - pairs) / pairs;
        },
        onIteration: (iteration, theta, score) => {
          if ((iteration + 1) % 5 === 0) log(`#${iteration + 1} score ${score.toFixed(2)} [${format(theta)}]`);
          if (values.out) writeFileSync(values.out, JSON.stringify(theta.map((value) => Math.round(value * 1000) / 1000)));
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
