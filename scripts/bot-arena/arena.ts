// Bot arena: plays the candidate bots (this working tree) against the baseline bots (a git ref) through the
// real game managers and reports whether the candidate is stronger. Usage and how to read the report:
// docs/development.md#bot-對戰場.
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GAME_TYPES } from '@shared/constants';
import type { GameOptions, GameSeat, GameType } from '@shared/types';
import { seedFromText } from '../../server/src/bots/search/seeded-random';
import { loadArenaBot } from './arena-bots';
import type { ArenaBot } from './arena-bots';
import { arenaSeats, playMatch } from './arena-match';
import type { MatchRecord, Side } from './arena-match';
import { installSeededRandom } from './arena-random';
import { formatSummary, summarize } from './arena-report';
import { checkoutBaseline, removeBaseline, useBaselineShared } from './baseline-checkout';

const USAGE = 'Usage: npm run bots:arena -- --game <type> [--matches 40] [--baseline main] [--budget <ms>] '
  + '[--seed 1] [--parallel 1] [--players <n>] [--options <json>] [--json]';
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface WorkerConfig {
  readonly gameType: GameType;
  readonly seats: readonly GameSeat[];
  readonly baselineRoot: string;
  readonly budgetMs?: number;
  readonly seed: number;
  readonly options: GameOptions;
  readonly pairs: readonly number[];
}

type WorkerMessage =
  | { readonly type: 'ready'; readonly budgets: Readonly<Record<Side, number | null>> }
  | { readonly type: 'record'; readonly record: MatchRecord }
  | { readonly type: 'failed'; readonly message: string };

interface Options {
  readonly gameType: GameType;
  readonly matches: number;
  readonly baseline: string;
  readonly budgetMs?: number;
  readonly seed: number;
  readonly parallel: number;
  readonly players?: number;
  /** Room options of the chosen game, keyed by its type as `startGame` expects. */
  readonly options: GameOptions;
  readonly json: boolean;
}

function positiveInteger(value: string | undefined, name: string, fallback?: number): number | undefined {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || (number === 0 && name !== 'seed')) {
    throw new Error(`--${name} must be a ${name === 'seed' ? 'non-negative' : 'positive'} integer.`);
  }
  return number;
}

/** The `--options` JSON is one game's own option object; the game manager validates its fields. */
export function parseGameOptions(gameType: GameType, text: string | undefined): GameOptions {
  if (text === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('--options must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('--options must be a JSON object.');
  return { [gameType]: parsed } as GameOptions;
}

function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      game: { type: 'string' }, matches: { type: 'string' }, baseline: { type: 'string' }, budget: { type: 'string' },
      seed: { type: 'string' }, parallel: { type: 'string' }, players: { type: 'string' }, options: { type: 'string' }, json: { type: 'boolean' },
    },
    strict: true,
  });
  const gameType = GAME_TYPES.find((type) => type === values.game);
  if (!gameType) throw new Error(`--game must be one of: ${GAME_TYPES.join(', ')}.`);
  return {
    gameType,
    matches: positiveInteger(values.matches, 'matches', 40)!,
    baseline: values.baseline ?? 'main',
    budgetMs: positiveInteger(values.budget, 'budget'),
    seed: positiveInteger(values.seed, 'seed', 1)!,
    parallel: Math.min(positiveInteger(values.parallel, 'parallel', 1)!, availableParallelism()),
    players: positiveInteger(values.players, 'players'),
    options: parseGameOptions(gameType, values.options),
    json: values.json ?? false,
  };
}

/** Both matches of a pair deal from this seed. */
const pairSeed = (seed: number, gameType: GameType, pair: number): number => seedFromText(`${seed}:${gameType}:${pair}`);

async function loadBots(config: WorkerConfig): Promise<Record<Side, ArenaBot>> {
  installSeededRandom();
  useBaselineShared(config.baselineRoot);
  return {
    candidate: await loadArenaBot(REPO_ROOT, config.gameType, config.budgetMs),
    baseline: await loadArenaBot(config.baselineRoot, config.gameType, config.budgetMs),
  };
}

function* playPairs(config: WorkerConfig, bots: Readonly<Record<Side, ArenaBot>>): Generator<MatchRecord> {
  for (const pair of config.pairs) {
    for (const swapped of [false, true]) {
      yield playMatch({ gameType: config.gameType, seats: config.seats, pair, swapped, options: config.options,
        seed: pairSeed(config.seed, config.gameType, pair) }, bots);
    }
  }
}

/** Child process: plays its share of the pairs and streams each record to the parent. */
function runWorker(): void {
  const send = (message: WorkerMessage): void => { process.send?.(message); };
  process.once('message', (config: WorkerConfig) => {
    void (async (): Promise<void> => {
      try {
        const bots = await loadBots(config);
        send({ type: 'ready', budgets: { candidate: bots.candidate.budgetMs, baseline: bots.baseline.budgetMs } });
        for (const record of playPairs(config, bots)) send({ type: 'record', record });
      } catch (error) {
        send({ type: 'failed', message: error instanceof Error ? error.stack ?? error.message : String(error) });
      }
      process.disconnect();
    })();
  });
}

/** Runs `config` split across `parallel` child processes; resolves with every record. */
function runForked(
  config: WorkerConfig, parallel: number, onRecord: (record: MatchRecord) => void,
  onReady: (budgets: Readonly<Record<Side, number | null>>) => void, children: ChildProcess[],
): Promise<void> {
  const shares = Array.from({ length: parallel }, (_, worker) => config.pairs.filter((_, index) => index % parallel === worker))
    .filter((pairs) => pairs.length > 0);
  return Promise.all(shares.map((pairs) => new Promise<void>((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child);
    let failure: string | null = null;
    child.on('message', (message: WorkerMessage) => {
      if (message.type === 'ready') onReady(message.budgets);
      else if (message.type === 'record') onRecord(message.record);
      else failure = message.message;
    });
    child.on('error', reject);
    child.on('exit', (code) => (failure || code ? reject(new Error(failure ?? `A worker exited with code ${code}.`)) : resolve()));
    child.send({ ...config, pairs });
  }))).then(() => undefined);
}

const describeBudget = (budget: number | null): string => (budget === null ? 'hard strategy' : `search, ${budget} ms budget`);

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const seats = arenaSeats(options.gameType, options.players);
  const pairs = Math.ceil(options.matches / 2);
  const checkout = await checkoutBaseline(REPO_ROOT, options.baseline);
  const children: ChildProcess[] = [];
  const interrupt = (): void => {
    for (const child of children) child.kill();
    void removeBaseline(checkout.root).finally(() => process.exit(130));
  };
  process.once('SIGINT', interrupt);
  const config: WorkerConfig = {
    gameType: options.gameType, seats, baselineRoot: checkout.root, budgetMs: options.budgetMs, seed: options.seed,
    options: options.options, pairs: Array.from({ length: pairs }, (_, pair) => pair),
  };
  const records: MatchRecord[] = [];
  let budgets: Readonly<Record<Side, number | null>> | null = null;
  const progress = (record: MatchRecord): void => {
    records.push(record);
    if (process.stderr.isTTY) process.stderr.write(`\r${records.length}/${pairs * 2} matches`);
  };
  try {
    if (options.parallel > 1) {
      await runForked(config, options.parallel, progress, (ready) => { budgets ??= ready; }, children);
    } else {
      const bots = await loadBots(config);
      budgets = { candidate: bots.candidate.budgetMs, baseline: bots.baseline.budgetMs };
      for (const record of playPairs(config, bots)) progress(record);
    }
  } finally {
    process.off('SIGINT', interrupt);
    await removeBaseline(checkout.root);
  }
  if (process.stderr.isTTY) process.stderr.write('\n');
  records.sort((a, b) => a.pair - b.pair || Number(a.swapped) - Number(b.swapped));
  const summary = summarize(records);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ game: options.gameType, seats, seed: options.seed, options: options.options,
      baseline: { ref: options.baseline, commit: checkout.commit }, budgets, summary }, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatSummary(summary, [
    `game      ${options.gameType}, seats ${seats.join(' ')}, ${pairs} duplicate pairs, seed ${options.seed}${
      Object.keys(options.options).length > 0 ? `, options ${JSON.stringify(options.options[options.gameType])}` : ''}`,
    `candidate working tree (${describeBudget(budgets?.candidate ?? null)})`,
    `baseline  ${options.baseline} ${checkout.commit.slice(0, 8)} (${describeBudget(budgets?.baseline ?? null)})`,
  ]));
}

if (process.argv.includes('--worker')) {
  runWorker();
} else if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`);
    process.exitCode = 1;
  });
}
