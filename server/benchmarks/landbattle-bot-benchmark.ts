// Land Battle Chess bot strength: seeded matches between two bot policies, colours alternating per game.

import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { GameSeat, LandBattleVisibleState, PlayerInfo } from '@shared/types';
import type { BotAction } from '../src/bots/bot-decisions';
import { easyLandBattleAction, getLandBattleBotAction } from '../src/bots/landbattle-strategy';
import { landBattleSearch } from '../src/bots/landbattle-search';
import type { SearchContext } from '../src/bots/search/search-types';
import { seededRandom } from '../src/bots/search/seeded-random';
import * as landbattle from '../src/managers/games/landbattle-game';

/** Per-decision limit of a search policy: a wall clock, or a fixed number of sampled worlds for exact replays. */
interface Budget { readonly ms: number; readonly samples: number | null }
type Policy = (visible: LandBattleVisibleState, random: () => number, budget: Budget) => BotAction | null;
type SearchFn = (visible: LandBattleVisibleState, context: SearchContext) => BotAction | null;
type SyncFn = (visible: LandBattleVisibleState, random: () => number) => BotAction | null;

interface Options {
  a: string;
  b: string;
  games: number;
  seed: number;
  budgetMs: number;
  samples: number | null;
  baseline: string | null;
}

const POLICIES = ['search', 'sync', 'easy', 'base-search', 'base-sync'];
/** Moves after which a match that never ends is scored a draw; the quiet-move limit normally ends it first. */
const MOVE_CAP = 3_000;

function parseOptions(args: readonly string[]): Options {
  const options: Options = { a: 'search', b: 'sync', games: 20, seed: 1, budgetMs: 100, samples: null, baseline: null };
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!value) throw new Error(`${flag} needs a value.`);
    if (flag === '--a' || flag === '--b') {
      if (!POLICIES.includes(value)) throw new Error(`${flag} accepts ${POLICIES.join(', ')}.`);
      options[flag === '--a' ? 'a' : 'b'] = value;
    } else if (flag === '--games' || flag === '--seed' || flag === '--budget' || flag === '--samples') {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1) throw new Error(`${flag} must be a positive integer.`);
      if (flag === '--games') options.games = number;
      else if (flag === '--seed') options.seed = number;
      else if (flag === '--samples') options.samples = number;
      else options.budgetMs = number;
    } else if (flag === '--baseline') options.baseline = resolve(value);
    else throw new Error(`Unknown option ${flag}. Use --a, --b, --games, --seed, --budget, --samples, or --baseline.`);
  }
  if ([options.a, options.b].some((policy) => policy.startsWith('base-')) && !options.baseline) {
    throw new Error('base-search and base-sync need --baseline <directory with the older landbattle-*.ts modules>.');
  }
  return options;
}

function searchPolicy(search: SearchFn): Policy {
  return (visible, random, budget) => {
    const started = performance.now();
    let checks = 0;
    // The search asks once per sampled world, so a sample limit makes a decision depend only on its seed.
    const expired = budget.samples === null
      ? (): boolean => performance.now() >= started + budget.ms
      : (): boolean => ++checks >= budget.samples!;
    return search(visible, {
      random,
      budget: { maxDepth: undefined, timeLeftMs: () => Math.max(0, started + budget.ms - performance.now()), expired },
    });
  };
}

async function policies(options: Options): Promise<Record<string, Policy>> {
  const table: Record<string, Policy> = {
    search: searchPolicy(landBattleSearch),
    sync: (visible, random) => getLandBattleBotAction(visible, random),
    easy: (visible, random) => easyLandBattleAction(visible, random),
  };
  if (options.baseline) {
    const searchModule = await import(pathToFileURL(`${options.baseline}/landbattle-search.ts`).href) as { landBattleSearch: SearchFn };
    const syncModule = await import(pathToFileURL(`${options.baseline}/landbattle-strategy.ts`).href) as { getLandBattleBotAction: SyncFn };
    table['base-search'] = searchPolicy(searchModule.landBattleSearch);
    table['base-sync'] = (visible, random) => syncModule.getLandBattleBotAction(visible, random);
  }
  return table;
}

const player = (seat: GameSeat): PlayerInfo => ({
  id: seat, username: seat, nickname: seat, color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
});

interface Timing { decisions: number; totalMs: number; maxMs: number; fallbacks: number }

/** One match; returns the winning policy key ('a' or 'b'), or null for a draw, and the reason. */
function playMatch(
  code: string, seed: number, aSeat: GameSeat, policyOf: (seat: GameSeat) => Policy, budget: Budget,
  timingOf: (seat: GameSeat) => Timing,
): { winner: 'a' | 'b' | null; reason: string; moves: number } {
  landbattle.startGame(code, { N: player('N'), S: player('S') }, 60_000, 1_000);
  const act = (seat: GameSeat, action: BotAction | null): void => {
    if (action?.type !== 'game-action' || action.request.gameType !== 'landbattle') throw new Error(`No action for ${seat}.`);
    const request = action.request.action;
    const result = request.type === 'deploy'
      ? landbattle.deploy(code, seat, request.layout, true, 1_000)
      : request.type === 'move' ? landbattle.move(code, seat, request.from, request.to) : { success: false, reason: 'Unexpected action' };
    if (!result.success) throw new Error(`Rejected ${seat} action: ${result.reason ?? 'unknown'}.`);
  };
  for (const [offset, seat] of (['N', 'S'] as const).entries()) {
    act(seat, policyOf(seat)(landbattle.getPlayerVisibleState(code, seat)!, seededRandom(seed * 7919 + offset), budget));
  }
  let moves = 0;
  for (; moves < MOVE_CAP && landbattle.getGameState(code)!.phase === 'playing'; moves++) {
    const seat = landbattle.getGameState(code)!.currentTurnSeat;
    const started = performance.now();
    const visible = landbattle.getPlayerVisibleState(code, seat)!;
    const random = seededRandom(seed * 100_003 + moves);
    let action = policyOf(seat)(visible, random, budget);
    // Like the runtime, a search that returns nothing is answered by the easy policy.
    if (!action) {
      timingOf(seat).fallbacks++;
      action = easyLandBattleAction(visible, random);
    }
    const elapsed = performance.now() - started;
    const timing = timingOf(seat);
    timing.decisions++;
    timing.totalMs += elapsed;
    timing.maxMs = Math.max(timing.maxMs, elapsed);
    act(seat, action);
  }
  const result = landbattle.getGameState(code)!.result;
  landbattle.abortGame(code);
  const winnerSeat = result?.winners.length === 1 ? result.winners[0] : null;
  return { winner: winnerSeat === null ? null : winnerSeat === aSeat ? 'a' : 'b', reason: result?.reason ?? 'move-cap', moves };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const table = await policies(options);
  const timing: Record<'a' | 'b', Timing> = {
    a: { decisions: 0, totalMs: 0, maxMs: 0, fallbacks: 0 }, b: { decisions: 0, totalMs: 0, maxMs: 0, fallbacks: 0 },
  };
  const score = { a: 0, b: 0, draw: 0 };
  const reasons: Record<string, number> = {};
  for (let game = 0; game < options.games; game++) {
    const seed = options.seed + game;
    // Each seed is played once; colours alternate so neither policy always moves first.
    const aSeat: GameSeat = game % 2 === 0 ? 'N' : 'S';
    const key = (seat: GameSeat): 'a' | 'b' => (seat === aSeat ? 'a' : 'b');
    const outcome = playMatch(`LBBENCH${seed}`, seed, aSeat, (seat) => table[options[key(seat)]],
      { ms: options.budgetMs, samples: options.samples }, (seat) => timing[key(seat)]);
    score[outcome.winner ?? 'draw']++;
    reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;
    process.stderr.write(`seed ${seed}: a=${options.a} as ${aSeat}, ${outcome.winner ?? 'draw'} by ${outcome.reason} after ${outcome.moves} moves\n`);
  }
  const summary = (side: 'a' | 'b'): { averageMs: number; maximumMs: number; fallbacks: number } => ({
    averageMs: Math.round(timing[side].totalMs / Math.max(1, timing[side].decisions)),
    maximumMs: Math.round(timing[side].maxMs),
    fallbacks: timing[side].fallbacks,
  });
  process.stdout.write(`${JSON.stringify({
    workload: 'landbattle-bot-match', a: options.a, b: options.b, seeds: [options.seed, options.seed + options.games - 1],
    budgetMs: options.samples === null ? options.budgetMs : null, samples: options.samples, wins: score.a, losses: score.b, draws: score.draw, reasons,
    timing: { a: summary('a'), b: summary('b') },
    node: process.version, platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
  })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
