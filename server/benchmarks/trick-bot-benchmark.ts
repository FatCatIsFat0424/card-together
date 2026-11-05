import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Card, PlayerInfo, PlayerVisibleGameState, Seat } from '@shared/types';
import { createDeck, shuffleDeck } from '../src/engine/deck';
import * as hearts from '../src/managers/games/hearts-game';
import * as gongzhu from '../src/managers/games/gongzhu-game';
import * as spades from '../src/managers/games/spades-game';
import { getBotAction } from '../src/bots/bot-decisions';
import type { BotAction } from '../src/bots/bot-decisions';
import { seededRandom } from '../src/bots/search/seeded-random';

type TrickGame = 'hearts' | 'gongzhu' | 'spades';
type View = Extract<PlayerVisibleGameState, { gameType: TrickGame }>;
type Policy = (view: View, random: () => number) => BotAction | null;
interface Options {
  readonly game: TrickGame | 'all'; readonly deals: number; readonly seed: number;
  readonly baseline: string | null; readonly candidate: string | null;
}
const SEATS: readonly Seat[] = ['N', 'E', 'S', 'W'];
const CODE = 'BOTBENCH';
const NOW = 1_000;
const PLAYERS = Object.fromEntries(SEATS.map((seat) => [seat, {
  id: `bench-${seat}`, username: `bench_${seat}`, nickname: `Bench ${seat}`,
  color: '#123456', avatar: 'cat', avatarImage: null, isBot: true,
} satisfies PlayerInfo])) as Record<Seat, PlayerInfo>;

function options(args: readonly string[]): Options {
  let game: Options['game'] = 'all';
  let deals = 64;
  let seed = 1;
  let baseline: string | null = null;
  let candidate: string | null = null;
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (!value) throw new Error(`${flag} needs a value.`);
    if (flag === '--game' && ['all', 'hearts', 'gongzhu', 'spades'].includes(value)) game = value as Options['game'];
    else if (flag === '--baseline') baseline = resolve(value);
    else if (flag === '--candidate') candidate = resolve(value);
    else if (flag === '--deals' || flag === '--seed') {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${flag} must be a positive safe integer.`);
      if (flag === '--deals') deals = number;
      else seed = number;
    } else throw new Error('Use --game all|hearts|gongzhu|spades, --deals, --seed, --candidate <bots directory>, or --baseline <older bots directory>.');
  }
  return { game, deals, seed, baseline, candidate };
}

async function policy(game: TrickGame, directory: string | null, difficulty: 'hard' | 'easy'): Promise<Policy> {
  if (!directory) return (view, random) => getBotAction(view, random, difficulty);
  const exports = await import(pathToFileURL(`${directory}/${game}-strategy.ts`).href) as Record<string, unknown>;
  const name = game === 'hearts' ? 'getHeartsBotAction' : game === 'gongzhu' ? 'getGongZhuBotAction' : 'getSpadesBotAction';
  const policy = exports[name];
  if (typeof policy !== 'function') throw new Error(`Missing policy export ${name}.`);
  return policy as Policy;
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing benchmark state or decision.');
  return value;
}

/** Real manager actions, each decided from the actor's own filtered snapshot. */
function hand(game: TrickGame, deck: readonly Card[], seed: number, side: Seat, candidate: Policy, rival: Policy): { margin: number; share: number; decisions: number; ms: number } {
  const random = Object.fromEntries(SEATS.map((seat, index) => [seat, seededRandom(seed + 7919 * index)])) as Record<Seat, () => number>;
  const mine = (seat: Seat): boolean => game === 'spades' ? SEATS.indexOf(seat) % 2 === SEATS.indexOf(side) % 2 : seat === side;
  let decisions = 0;
  let ms = 0;
  const read = (seat: Seat): View => required(game === 'hearts' ? hearts.getPlayerVisibleState(CODE, seat)
    : game === 'gongzhu' ? gongzhu.getPlayerVisibleState(CODE, seat) : spades.getPlayerVisibleState(CODE, seat));
  const scores = (): Record<Seat, number> | null => {
    if (game === 'hearts') {
      const entry = required(hearts.getGameState(CODE)).log.find((entry) => entry.type === 'hand_end');
      return entry?.type === 'hand_end' ? Object.fromEntries(SEATS.map((seat) => [seat, -entry.score.added[seat]])) as Record<Seat, number> : null;
    }
    if (game === 'gongzhu') return gongzhu.getGameState(CODE)?.handResults[0]?.scores ?? null;
    const result = spades.getGameState(CODE)?.handResults[0];
    return result ? { N: result.teams.NS.points, S: result.teams.NS.points, E: result.teams.EW.points, W: result.teams.EW.points } : null;
  };
  try {
    if (game === 'hearts') hearts.startGame(CODE, PLAYERS, 30_000, deck, NOW);
    else if (game === 'gongzhu') gongzhu.startGame(CODE, PLAYERS, deck, NOW);
    else spades.startGame(CODE, PLAYERS, deck, 'W', NOW);
    for (let index = 0; index < 100 && scores() === null; index++) {
      const state = read('N');
      const seat = state.gameType === 'hearts' && state.phase === 'passing'
        ? required(SEATS.find((seat) => !state.passedSeats.includes(seat))) : required(state.currentTurnSeat);
      const started = performance.now();
      const view = read(seat);
      const action = required(mine(seat) ? candidate(view, random[seat]) : rival(view, random[seat]));
      ms += performance.now() - started;
      decisions++;
      if (action.type !== 'game-action' || action.request.gameType !== game) throw new Error(`Unexpected ${game} action.`);
      const request = action.request;
      const result = request.gameType === 'hearts' ? hearts.act(CODE, seat, request.action, NOW, () => [...deck])
        : request.gameType === 'gongzhu' ? gongzhu.playCard(CODE, seat, request.action.card, NOW)
          : spades.act(CODE, seat, request.action, NOW);
      if (!result.success) throw new Error(`${game}/${seat}: ${result.reason}`);
    }
    const score = required(scores());
    const enemies = SEATS.filter((seat) => !mine(seat));
    const margin = score[side] - enemies.reduce((sum, seat) => sum + score[seat], 0) / enemies.length;
    const best = Math.max(...SEATS.map((seat) => score[seat]));
    const winnerSeats = SEATS.filter((seat) => score[seat] === best);
    const share = game === 'spades' ? margin > 0 ? 1 : margin === 0 ? 0.5 : 0 : score[side] === best ? 1 / winnerSeats.length : 0;
    return { margin, share, decisions, ms };
  } finally {
    if (game === 'hearts') hearts.abortGame(CODE);
    else if (game === 'gongzhu') gongzhu.abortGame(CODE);
    else spades.abortGame(CODE);
  }
}

async function main(): Promise<void> {
  const config = options(process.argv.slice(2));
  const games: readonly TrickGame[] = config.game === 'all' ? ['hearts', 'gongzhu', 'spades'] : [config.game];
  for (const game of games) {
    const candidate = await policy(game, config.candidate, 'hard');
    const rival = await policy(game, config.baseline, 'easy');
    const sides = game === 'spades' ? SEATS.slice(0, 2) : SEATS;
    const outcomes = Array.from({ length: config.deals }, (_, index) => {
      const seed = config.seed + index;
      const deck = shuffleDeck(createDeck(), seededRandom(seed));
      return sides.map((side) => hand(game, deck, seed * 1009, side, candidate, rival));
    }).flat();
    const total = outcomes.reduce((sum, result) => ({ margin: sum.margin + result.margin, share: sum.share + result.share,
      decisions: sum.decisions + result.decisions, ms: sum.ms + result.ms }), { margin: 0, share: 0, decisions: 0, ms: 0 });
    process.stdout.write(`${JSON.stringify({ workload: 'trick-bot-hand', game, policy: 'hard', opponent: config.baseline ? 'baseline-hard' : 'easy',
      seeds: [config.seed, config.seed + config.deals - 1], deals: config.deals, seatRotations: sides.length, hands: outcomes.length,
      winShare: total.share / outcomes.length, meanPointMargin: total.margin / outcomes.length,
      decisions: total.decisions, averageDecisionMs: total.ms / total.decisions,
      note: 'First-hand comparison with seat rotation; positive margins favor hard. Not a full-match or human-strength rating.' })}\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
