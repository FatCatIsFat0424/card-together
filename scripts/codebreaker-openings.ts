// Precomputes the Code Breaker bot's second and third guesses. After the fixed opening, the best reply depends
// only on the feedback seen so far, so each reply is chosen once, offline, by playing every secret that is still
// possible against every promising reply with the runtime policy for the rest of the game. The result is written
// to server/src/bots/codebreaker-openings.ts. Usage:
//   tsx --tsconfig server/tsconfig.json scripts/codebreaker-openings.ts [--write] [--variant colors|digits]
//     [--second 120] [--third 40] [--report]
// Without --write the plan is only printed together with the mean guesses it achieves over every secret.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { CbVariant } from '@shared/rules/codebreaker';
import { CODEBREAKER_OPENING, CODEBREAKER_PLAN } from '../server/src/bots/codebreaker-openings';
import {
  EXACT_LIMIT, NO_LIMIT, SOLVED_KEY, bestGuesses, chooseGuessIndex, codeSpace, feedbackKey, indexOfCode, solveExactGuess,
} from '../server/src/bots/codebreaker-solver';
import type { CodeSpace } from '../server/src/bots/codebreaker-solver';

const OUTPUT = new URL('../server/src/bots/codebreaker-openings.ts', import.meta.url);

interface Plan {
  readonly variant: CbVariant;
  readonly space: CodeSpace;
  /** Planned guess per feedback path ("7", "7.12"), as code indices */
  readonly chosen: Map<string, number>;
  /** Table-free policy decisions by candidate set */
  readonly memo: Map<string, number>;
  /** Lookahead levels of the policy that plays the rest of each evaluated game; undefined for the runtime default */
  readonly baseDepth?: number;
}

function newPlan(variant: CbVariant, existing: Readonly<Record<string, string>>, keep: boolean, baseDepth?: number): Plan {
  const space = codeSpace(variant);
  const chosen = new Map<string, number>();
  if (keep) {
    for (const [path, code] of Object.entries(existing)) chosen.set(path, indexOfCode(space, Array.from(code, Number)));
  }
  return { variant, space, chosen, memo: new Map(), baseDepth };
}

/** The policy below the planned levels: the runtime solver, remembered per candidate set. */
function basePolicy(plan: Plan, candidates: Int32Array): number {
  const key = candidates.join();
  let guess = plan.memo.get(key);
  if (guess === undefined) {
    guess = chooseGuessIndex(plan.space, candidates, NO_LIMIT, plan.baseDepth);
    plan.memo.set(key, guess);
  }
  return guess;
}

/** Sum over the candidates of the guesses needed when `guess` is played now, then the plan or base policy. */
function total(plan: Plan, candidates: Int32Array, guess: number, path: string, usePlan: boolean, tally?: number[], depth = 0): number {
  const groups = new Map<number, number[]>();
  for (const secret of candidates) {
    const key = feedbackKey(plan.space, guess, secret);
    if (key === SOLVED_KEY) {
      if (tally) tally[depth + 1]++;
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(secret);
    else groups.set(key, [secret]);
  }
  let sum = candidates.length;
  for (const [key, list] of groups) {
    const bucket = Int32Array.from(list);
    const childPath = path === '' ? String(key) : `${path}.${key}`;
    const planned = usePlan ? plan.chosen.get(childPath) : undefined;
    const next = bucket.length === 1 ? bucket[0] : planned ?? basePolicy(plan, bucket);
    sum += total(plan, bucket, next, childPath, usePlan, tally, depth + 1);
  }
  return sum;
}

/** The reply to a node that minimizes the total guesses over its candidates. */
function optimize(plan: Plan, candidates: Int32Array, path: string, width: number, usePlan: boolean): number {
  const options = new Set<number>(bestGuesses(plan.space, candidates, width).map((option) => option.guess));
  options.add(basePolicy(plan, candidates));
  if (candidates.length <= 40) for (const secret of candidates) options.add(secret);
  let best = -1;
  let bestTotal = Infinity;
  for (const guess of options) {
    const sum = total(plan, candidates, guess, path, usePlan);
    if (sum < bestTotal - 1e-9) {
      bestTotal = sum;
      best = guess;
    }
  }
  return best;
}

/** Buckets reached after `path`, as feedback key to candidate set. */
function children(plan: Plan, candidates: Int32Array, guess: number): Map<number, Int32Array> {
  const groups = new Map<number, number[]>();
  for (const secret of candidates) {
    const key = feedbackKey(plan.space, guess, secret);
    if (key === SOLVED_KEY) continue;
    const list = groups.get(key);
    if (list) list.push(secret);
    else groups.set(key, [secret]);
  }
  return new Map(Array.from(groups, ([key, list]) => [key, Int32Array.from(list)]));
}

/** Candidate sets up to this size are solved exactly offline instead of compared among a few replies. */
let EXACT_PLAN = 36;
/** Deepest guess number the plan covers. */
const MAX_LEVEL = 6;

function plannedNodes(plan: Plan, widths: readonly number[], usePlan: boolean): void {
  const all = Int32Array.from({ length: plan.space.codes.length }, (_, index) => index);
  const opening = indexOfCode(plan.space, CODEBREAKER_OPENING[plan.variant]);
  const exactMemo = new Map<string, number>();
  let level: { path: string; candidates: Int32Array; guess: number }[] = [{ path: '', candidates: all, guess: opening }];
  for (let depth = 0; depth < MAX_LEVEL - 1 && level.length > 0; depth++) {
    const width = widths[Math.min(depth, widths.length - 1)];
    const next: typeof level = [];
    for (const node of level) {
      for (const [key, bucket] of children(plan, node.candidates, node.guess)) {
        const path = node.path === '' ? String(key) : `${node.path}.${key}`;
        if (bucket.length <= EXACT_LIMIT) continue;
        const guess = bucket.length <= EXACT_PLAN ? solveExactGuess(plan.space, bucket, NO_LIMIT) : optimize(plan, bucket, path, width, usePlan);
        exactMemo.set(path, guess);
        plan.chosen.set(path, guess);
        next.push({ path, candidates: bucket, guess });
        console.error(`  ${plan.variant} ${path}: ${bucket.length} left -> ${plan.space.codes[guess].join('')}`);
      }
    }
    level = next;
  }
}

function report(plan: Plan): void {
  const space = plan.space;
  const all = Int32Array.from({ length: space.codes.length }, (_, index) => index);
  const tally = new Array<number>(12).fill(0);
  const sum = total(plan, all, indexOfCode(space, CODEBREAKER_OPENING[plan.variant]), '', true, tally);
  process.stdout.write(`${plan.variant}: mean ${(sum / all.length).toFixed(4)} guesses over all ${all.length} secrets, `
    + `longest ${tally.findLastIndex((count) => count > 0)}, by count ${tally.slice(1, 9).join(' ')}\n`);
}

function planSource(plans: readonly Plan[]): string {
  const lines = [
    '// Generated by scripts/codebreaker-openings.ts; do not edit by hand.',
    '// The opening guess and the planned second and third guesses of the Code Breaker bot, per variant. A path is',
    '// the feedback keys (exact * 5 + partial) seen so far, joined by dots; the value is the code to guess next.',
    "import type { CbCode, CbVariant } from '@shared/rules/codebreaker';",
    '',
    '/** First guess of each variant; other openings are relabelings of it. */',
    'export const CODEBREAKER_OPENING: Readonly<Record<CbVariant, CbCode>> = {',
    `  digits: [${CODEBREAKER_OPENING.digits.join(', ')}],`,
    `  colors: [${CODEBREAKER_OPENING.colors.join(', ')}],`,
    '};',
    '',
    'export const CODEBREAKER_PLAN: Readonly<Record<CbVariant, Readonly<Record<string, string>>>> = {',
  ];
  for (const plan of plans) {
    lines.push(`  ${plan.variant}: {`);
    const entries = [...plan.chosen].sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
    for (const [path, guess] of entries) lines.push(`    '${path}': '${plan.space.codes[guess].join('')}',`);
    lines.push('  },');
  }
  lines.push('};', '');
  return lines.join('\n');
}

const { values } = parseArgs({
  options: {
    write: { type: 'boolean' }, variant: { type: 'string' }, second: { type: 'string' }, third: { type: 'string' },
    report: { type: 'boolean' }, passes: { type: 'string' }, 'base-depth': { type: 'string' }, 'exact-plan': { type: 'string' },
  },
});
if (values['exact-plan']) EXACT_PLAN = Number(values['exact-plan']);
const variants = (values.variant ? [values.variant] : ['colors', 'digits']) as CbVariant[];
const widths = [Number(values.second ?? 120), ...(Number(values.third ?? 40) > 0 ? [Number(values.third ?? 40)] : [])];
const plans = (['digits', 'colors'] as const).map((variant) => {
  const plan = newPlan(variant, CODEBREAKER_PLAN[variant], values.report === true || !variants.includes(variant),
    values['base-depth'] === undefined ? undefined : Number(values['base-depth']));
  if (variants.includes(variant) && !values.report) {
    for (let pass = 0; pass < Number(values.passes ?? 1); pass++) plannedNodes(plan, widths, pass > 0);
  }
  if (variants.includes(variant)) report(plan);
  return plan;
});
if (values.write) writeFileSync(OUTPUT, planSource(plans));
