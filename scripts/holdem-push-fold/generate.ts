// Solves first-in push/fold Hold'em for the bot's short-stack charts and writes
// server/src/bots/holdem-push-fold-data.ts. Usage:
//   tsx scripts/holdem-push-fold/generate.ts [--samples 3000] [--seed 1] [--out <path>]
//
// Model: every seat starts the hand with the same stack (the effective stack, in big blinds); there are no antes.
// The first seat to enter the pot either moves all-in or folds, and the seats behind it, in order, call or fold.
// After a call the remaining seats fold (overcalls are rare and ignored). Payoffs are chip expectations from a
// 169 x 169 matrix of all-in equities between starting-hand classes, with card removal between the two hands.
// Fictitious play converges to an equilibrium for each number of seats behind (1 to 7) and stack depth; each
// chart stores, for every class, the deepest stack at which the class still pushes (or calls).

import { writeFileSync } from 'node:fs';
import { evaluateIds } from '../../server/src/bots/holdem-evaluator';

const CLASSES = 169;
const MAX_BEHIND = 7;
/** Stack depths solved, in big blinds; the chart threshold of a class is the deepest one where it plays. */
const STACKS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5,
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
];
const ITERATIONS = 600;
/** Encoding: one character per class, the threshold in half big blinds; the last code means "at every depth". */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ALWAYS = ALPHABET.length - 1;

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Card ids `(rank - 2) * 4 + suit` of every combo in a class; the class index follows holdem-preflop-table. */
function classCombos(index: number): [number, number][] {
  const row = Math.floor(index / 13);
  const column = index % 13;
  const combos: [number, number][] = [];
  if (row === column) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) combos.push([row * 4 + a, row * 4 + b]);
  } else if (row > column) {
    for (let suit = 0; suit < 4; suit++) combos.push([row * 4 + suit, column * 4 + suit]);
  } else {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) combos.push([column * 4 + a, row * 4 + b]);
  }
  return combos;
}

interface Matrix {
  /** Equity of the row class against the column class, ties split. */
  readonly equity: Float64Array;
  /** Share of combo pairs that do not share a card. */
  readonly compatible: Float64Array;
}

function equityMatrix(samples: number, random: () => number): Matrix {
  const combos = Array.from({ length: CLASSES }, (_, index) => classCombos(index));
  const equity = new Float64Array(CLASSES * CLASSES);
  const compatible = new Float64Array(CLASSES * CLASSES);
  const mine = new Array<number>(7).fill(0);
  const theirs = new Array<number>(7).fill(0);
  const deck = new Int8Array(52);
  const started = Date.now();
  for (let a = 0; a < CLASSES; a++) {
    for (let b = a; b < CLASSES; b++) {
      const pairs: [number, number][] = [];
      combos[a].forEach((first, i) => combos[b].forEach((second, j) => {
        if (first[0] !== second[0] && first[0] !== second[1] && first[1] !== second[0] && first[1] !== second[1]) pairs.push([i, j]);
      }));
      compatible[a * CLASSES + b] = pairs.length / (combos[a].length * combos[b].length);
      compatible[b * CLASSES + a] = compatible[a * CLASSES + b];
      if (pairs.length === 0) continue;
      let won = 0;
      for (let run = 0; run < samples; run++) {
        const [i, j] = pairs[Math.floor(random() * pairs.length)];
        const hero = combos[a][i];
        const villain = combos[b][j];
        let size = 0;
        for (let id = 0; id < 52; id++) {
          if (id !== hero[0] && id !== hero[1] && id !== villain[0] && id !== villain[1]) deck[size++] = id;
        }
        for (let k = 0; k < 5; k++) {
          const pick = k + Math.floor(random() * (size - k));
          const held = deck[k];
          deck[k] = deck[pick];
          deck[pick] = held;
          mine[2 + k] = deck[k];
          theirs[2 + k] = deck[k];
        }
        mine[0] = hero[0];
        mine[1] = hero[1];
        theirs[0] = villain[0];
        theirs[1] = villain[1];
        const difference = evaluateIds(mine, 7) - evaluateIds(theirs, 7);
        won += difference > 0 ? 1 : difference === 0 ? 0.5 : 0;
      }
      equity[a * CLASSES + b] = won / samples;
      equity[b * CLASSES + a] = 1 - won / samples;
    }
    if (a % 20 === 19) process.stderr.write(`equity rows ${a + 1}/${CLASSES} (${Math.round((Date.now() - started) / 1000)} s)\n`);
  }
  return { equity, compatible };
}

const combosOf = (index: number): number => {
  const row = Math.floor(index / 13);
  const column = index % 13;
  return row === column ? 6 : row > column ? 4 : 12;
};

interface Solution {
  readonly push: Float64Array;
  /** Calling strategy of each seat behind, nearest first. */
  readonly calls: Float64Array[];
}

/** Blinds already posted by the pusher and by each seat behind it, in big blinds. */
function postedBlinds(behind: number): { pusher: number; callers: number[] } {
  const callers = new Array<number>(behind).fill(0);
  callers[behind - 1] = 1;
  if (behind >= 2) callers[behind - 2] = 0.5;
  return { pusher: behind === 1 ? 0.5 : 0, callers };
}

/**
 * For each hero class h: the chance an opponent's hand is in `strategy`, and the equity of h against those hands,
 * both weighted by combos and card removal.
 */
function versus(matrix: Matrix, strategy: Float64Array, weights: Float64Array): { share: Float64Array; equity: Float64Array } {
  const share = new Float64Array(CLASSES);
  const equity = new Float64Array(CLASSES);
  for (let h = 0; h < CLASSES; h++) {
    let total = 0;
    let inRange = 0;
    let won = 0;
    for (let v = 0; v < CLASSES; v++) {
      const weight = weights[h * CLASSES + v];
      total += weight;
      const playing = weight * strategy[v];
      inRange += playing;
      won += playing * matrix.equity[h * CLASSES + v];
    }
    share[h] = total > 0 ? inRange / total : 0;
    equity[h] = inRange > 0 ? won / inRange : 0.5;
  }
  return { share, equity };
}

function solve(matrix: Matrix, weights: Float64Array, behind: number, stack: number, previous: Solution | null): Solution {
  const blinds = postedBlinds(behind);
  const dead = 1.5;
  const push = previous ? Float64Array.from(previous.push) : new Float64Array(CLASSES).fill(0.5);
  const calls = previous ? previous.calls.map((call) => Float64Array.from(call)) : Array.from({ length: behind }, () => new Float64Array(CLASSES).fill(0.2));
  for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
    const step = 1 / (iteration + 1);
    // Callers respond to the current pushing range.
    const facing = versus(matrix, push, weights);
    for (let seat = 0; seat < behind; seat++) {
      const pot = 2 * stack + dead - blinds.pusher - blinds.callers[seat];
      for (let h = 0; h < CLASSES; h++) {
        // Calling ends with equity * pot minus the stack; folding forfeits only the posted blind.
        const gain = facing.equity[h] * pot - stack + blinds.callers[seat];
        calls[seat][h] += ((gain > 0 ? 1 : 0) - calls[seat][h]) * step;
      }
    }
    // The pusher responds to the callers' current ranges.
    const responses = calls.map((call) => versus(matrix, call, weights));
    for (let h = 0; h < CLASSES; h++) {
      let reach = 1;
      let gain = 0;
      for (let seat = 0; seat < behind; seat++) {
        const calling = responses[seat].share[h];
        const pot = 2 * stack + dead - blinds.pusher - blinds.callers[seat];
        gain += reach * calling * (responses[seat].equity[h] * pot - stack + blinds.pusher);
        reach *= 1 - calling;
      }
      gain += reach * dead;
      push[h] += ((gain > 0 ? 1 : 0) - push[h]) * step;
    }
  }
  return { push, calls };
}

function encode(thresholds: readonly number[]): string {
  return thresholds.map((value) => ALPHABET[value]).join('');
}

function main(): void {
  const samples = Number(option('samples', '3000'));
  const seed = Number(option('seed', '1'));
  const out = option('out', 'server/src/bots/holdem-push-fold-data.ts');
  if (!Number.isInteger(samples) || samples < 100) throw new Error('--samples must be an integer of at least 100');
  const matrix = equityMatrix(samples, seededRandom(seed));
  const weights = new Float64Array(CLASSES * CLASSES);
  for (let h = 0; h < CLASSES; h++) {
    for (let v = 0; v < CLASSES; v++) weights[h * CLASSES + v] = combosOf(v) * matrix.compatible[h * CLASSES + v];
  }
  const push: string[] = [];
  const call: string[][] = [];
  for (let behind = 1; behind <= MAX_BEHIND; behind++) {
    const pushLimit = new Array<number>(CLASSES).fill(0);
    const callLimit = Array.from({ length: behind }, () => new Array<number>(CLASSES).fill(0));
    let previous: Solution | null = null;
    for (const stack of STACKS) {
      const solution = solve(matrix, weights, behind, stack, previous);
      previous = solution;
      const code = Math.min(ALWAYS - 1, Math.round(stack * 2));
      for (let h = 0; h < CLASSES; h++) {
        if (solution.push[h] >= 0.5) pushLimit[h] = code;
        for (let seat = 0; seat < behind; seat++) if (solution.calls[seat][h] >= 0.5) callLimit[seat][h] = code;
      }
    }
    const deepest = Math.round(STACKS[STACKS.length - 1] * 2);
    const finish = (limits: number[]): number[] => limits.map((value) => (value >= deepest ? ALWAYS : value));
    push.push(encode(finish(pushLimit)));
    call.push(callLimit.map((limits) => encode(finish(limits))));
    process.stderr.write(`solved ${behind} behind\n`);
  }
  const lines = [
    '// Generated by scripts/holdem-push-fold/generate.ts; do not edit by hand.',
    `// ${samples} equity samples per class pair, seed ${seed}, ${ITERATIONS} fictitious-play iterations per depth.`,
    '',
    '/**',
    ' * One character per starting-hand class (index `row * 13 + column` as in holdem-preflop-table): the deepest',
    ` * stack, in half big blinds, at which the class plays; "${ALPHABET[ALWAYS]}" plays at every depth. Decode with ALPHABET.`,
    ' */',
    `export const PUSH_FOLD_ALPHABET = '${ALPHABET}';`,
    '',
    '/** First-in all-in, by the number of seats still to act behind (index 0 = one seat). */',
    'export const PUSH_CHARTS: readonly string[] = [',
    ...push.map((chart) => `  '${chart}',`),
    '];',
    '',
    '/** Calling a first-in all-in, by the number of seats behind the pusher, then by the caller\'s place among them. */',
    'export const CALL_CHARTS: readonly (readonly string[])[] = [',
    ...call.map((charts) => `  [\n${charts.map((chart) => `    '${chart}',`).join('\n')}\n  ],`),
    '];',
    '',
  ];
  writeFileSync(out, lines.join('\n'));
  process.stderr.write(`wrote ${out}\n`);
}

main();
