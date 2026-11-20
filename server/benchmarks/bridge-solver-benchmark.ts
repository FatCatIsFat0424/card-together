// Bridge double-dummy solver speed on fixed seeded deals: full-deal solves and opening-lead decisions.
//
//   npm run bench:bridge-solver -- [--deals 12] [--samples 6] [--seed 1] [--solver <module path>]
//
// `--solver` loads another copy of bridge-solver.ts (for example one exported from main) to compare.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as current from '../src/bots/bridge-solver';
import { seededRandom } from '../src/bots/search/seeded-random';

type SolverModule = Pick<typeof current, 'createSolver' | 'solveTricks' | 'NO_TRUMP'>;

interface Options { deals: number; samples: number; seed: number; solver: string | null }

function parseOptions(args: readonly string[]): Options {
  const options: Options = { deals: 12, samples: 6, seed: 1, solver: null };
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    if (flag === '--solver') options.solver = value;
    else if (flag === '--deals' || flag === '--samples' || flag === '--seed') {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1) throw new Error(`${flag} must be a positive integer.`);
      options[flag.slice(2) as 'deals' | 'samples' | 'seed'] = number;
    } else throw new Error(`Unknown option ${flag}.`);
  }
  return options;
}

/** Processor time of this process, so other load on the machine does not distort the comparison. */
function cpuMs(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

function shuffle(cards: number[], random: () => number): void {
  for (let index = cards.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
}

/** Card codes (`suit * 13 + rank`) dealt 13 per seat into `hands[seat * 4 + suit]` rank masks. */
function handsOf(cards: readonly number[]): Int32Array {
  const hands = new Int32Array(16);
  cards.forEach((card, index) => { hands[Math.floor(index / 13) * 4 + Math.floor(card / 13)] |= 1 << (card % 13); });
  return hands;
}

/** One card per run of touching cards in the seat's hand: the opening-lead candidates. */
function leadCandidates(hands: Int32Array, seat: number): number[] {
  const cards: number[] = [];
  for (let suit = 0; suit < 4; suit++) {
    const holding = hands[seat * 4 + suit];
    for (let rank = 0; rank < 13; rank++) {
      if ((holding & (1 << rank)) !== 0 && (rank === 0 || (holding & (1 << (rank - 1))) === 0)) cards.push(suit * 16 + rank);
    }
  }
  return cards;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const solverModule: SolverModule = options.solver
    ? await import(pathToFileURL(resolve(options.solver)).href) as SolverModule
    : current;
  const { createSolver, solveTricks, NO_TRUMP } = solverModule;
  const random = seededRandom(options.seed);
  let solveNodes = 0;
  let solveMs = 0;
  let decisionNodes = 0;
  let decisionMs = 0;
  let slowestDecision = 0;
  console.log('deal trump  par  solve nodes cpu ms   lead nodes cpu ms');
  for (let deal = 0; deal < options.deals; deal++) {
    const deck = Array.from({ length: 52 }, (_, index) => index);
    shuffle(deck, random);
    const hands = handsOf(deck);
    const trump = deal % 5 === 4 ? NO_TRUMP : deal % 4;
    // North declares; East leads.
    const leader = 1;
    let started = cpuMs();
    const fresh = createSolver(trump, 0);
    const par = solveTricks(fresh, { hands, leader, trick: [] });
    const fullMs = cpuMs() - started;
    solveNodes += fresh.nodes();
    solveMs += fullMs;

    // Opening lead: East keeps its hand; the other 39 cards are redealt for every sample.
    const others = deck.filter((_, index) => Math.floor(index / 13) !== leader);
    const own = deck.slice(leader * 13, leader * 13 + 13);
    const solver = createSolver(trump, 0);
    started = cpuMs();
    for (let sample = 0; sample < options.samples; sample++) {
      shuffle(others, random);
      const layout = handsOf([...others.slice(0, 13), ...own, ...others.slice(13)]);
      for (const card of leadCandidates(layout, leader)) {
        const after = new Int32Array(layout);
        after[leader * 4 + (card >> 4)] &= ~(1 << (card & 15));
        solver.canReach({ hands: after, leader, trick: [{ seat: leader, suit: card >> 4, rank: card & 15 }] }, par);
      }
    }
    const leadMs = cpuMs() - started;
    decisionNodes += solver.nodes();
    decisionMs += leadMs;
    slowestDecision = Math.max(slowestDecision, leadMs);
    console.log(`${String(deal).padStart(4)} ${String(trump === NO_TRUMP ? 'NT' : 'CDHS'[trump]).padStart(5)} ${String(par).padStart(4)}`
      + ` ${String(fresh.nodes()).padStart(11)} ${fullMs.toFixed(0).padStart(6)} ${String(solver.nodes()).padStart(10)} ${leadMs.toFixed(0).padStart(6)}`);
  }
  console.log(`full-deal solves: ${solveNodes} nodes, ${solveMs.toFixed(0)} cpu ms (${(solveMs / options.deals).toFixed(0)} ms per deal)`);
  console.log(`opening leads (${options.samples} samples): ${decisionNodes} nodes, ${decisionMs.toFixed(0)} cpu ms`
    + ` (${(decisionMs / options.deals).toFixed(0)} ms average, ${slowestDecision.toFixed(0)} ms slowest)`);
}

await main();
