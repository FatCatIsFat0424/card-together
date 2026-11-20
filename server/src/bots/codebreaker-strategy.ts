import { performance } from 'node:perf_hooks';
import type { CodeBreakerVisibleState } from '@shared/types';
import { CB_MAX_GUESSES, cbConsistent, cbRandomCode, cbSymbolCount } from '@shared/rules/codebreaker';
import type { CbCode, CbKnownGuess, CbVariant } from '@shared/rules/codebreaker';
import type { BotAction } from './bot-decisions';
import { CODEBREAKER_OPENING, CODEBREAKER_PLAN } from './codebreaker-openings';
import { chooseGuessIndex, codeSpace, consistentIndices } from './codebreaker-solver';

/** Longest the exact search may run before the one-step estimate answers; typical decisions take a few ms. */
const SOLVE_LIMIT_MS = 150;

function guessAction(code: CbCode): BotAction {
  return { type: 'game-action', request: { gameType: 'codebreaker', action: { type: 'guess', code: [...code] } } };
}

/** The seat's own feedback so far: all a seat knows about the secret. */
export function knownGuesses(visible: CodeBreakerVisibleState): CbKnownGuess[] {
  return (visible.histories[visible.mySeat] ?? []).map(({ code, exact, partial }) => ({ code, exact, partial }));
}

/** Whether the seat must still submit a guess this round. */
export function owesGuess(visible: CodeBreakerVisibleState): boolean {
  const own = visible.progress[visible.mySeat];
  return visible.phase === 'playing' && visible.seats.includes(visible.mySeat) && own !== undefined
    && !own.solved && own.used < CB_MAX_GUESSES && visible.pendingGuess === null;
}

/** Codes that could still be the secret given the seat's own feedback. */
export function consistentCodes(visible: CodeBreakerVisibleState): readonly CbCode[] {
  const known = knownGuesses(visible);
  const { codes } = codeSpace(visible.options.variant);
  return known.length === 0 ? codes : codes.filter((code) => cbConsistent(code, known));
}

/** A symbol relabeling that carries the canonical opening onto the opening the seat actually played. */
type Relabeling = readonly number[];

/**
 * The relabeling taking `CODEBREAKER_OPENING` to `first`, or null when `first` is not such a relabeling. Symbols the
 * opening does not use are matched in ascending order: they are interchangeable, so any bijection serves.
 */
function relabelingTo(variant: CbVariant, first: CbCode): Relabeling | null {
  const canonical = CODEBREAKER_OPENING[variant];
  const map = new Map<number, number>();
  for (let slot = 0; slot < canonical.length; slot++) {
    const from = canonical[slot];
    const to = first[slot];
    if (map.has(from) ? map.get(from) !== to : [...map.values()].includes(to)) return null;
    map.set(from, to);
  }
  const symbols = cbSymbolCount(variant);
  const spare = Array.from({ length: symbols }, (_, symbol) => symbol).filter((symbol) => ![...map.values()].includes(symbol));
  const result: number[] = [];
  for (let symbol = 0; symbol < symbols; symbol++) result.push(map.get(symbol) ?? spare.shift()!);
  return result;
}

const relabel = (code: CbCode, labeling: Relabeling): CbCode => code.map((symbol) => labeling[symbol]);

/** A random relabeling, so that bots do not all open alike. */
function randomRelabeling(variant: CbVariant, random: () => number): Relabeling {
  const symbols = Array.from({ length: cbSymbolCount(variant) }, (_, symbol) => symbol);
  for (let index = symbols.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)));
    [symbols[index], symbols[other]] = [symbols[other], symbols[index]];
  }
  return symbols;
}

/**
 * The planned reply for the feedback so far, when every earlier guess followed the plan under one relabeling of
 * the opening; null once the seat has strayed (for example after a substituted guess) or the plan ends.
 */
function plannedGuess(variant: CbVariant, known: readonly CbKnownGuess[]): CbCode | null {
  const labeling = relabelingTo(variant, known[0].code);
  if (!labeling) return null;
  const plan = CODEBREAKER_PLAN[variant];
  const path: number[] = [];
  for (let step = 0; step < known.length; step++) {
    path.push(known[step].exact * 5 + known[step].partial);
    if (step === known.length - 1) break;
    const expected = plan[path.join('.')];
    if (expected === undefined || relabel(Array.from(expected, Number), labeling).join() !== known[step + 1].code.join()) return null;
  }
  const next = plan[path.join('.')];
  return next === undefined ? null : relabel(Array.from(next, Number), labeling);
}

/**
 * Plays the guess with the fewest expected guesses to the end. The opening is fixed, the next replies come from
 * a table computed offline over every possible secret (`scripts/codebreaker-openings.ts`), and the rest is
 * solved here: a lookahead estimate over every code for large candidate sets and exact search for small ones.
 * Rivals' progress cannot change the choice: every unsolved seat guesses once per round, so a seat that sees a
 * rival solved has already lost the race.
 */
export function getCodeBreakerBotAction(visible: CodeBreakerVisibleState, random: () => number): BotAction | null {
  if (!owesGuess(visible)) return null;
  const variant = visible.options.variant;
  const known = knownGuesses(visible);
  if (known.length === 0) return guessAction(relabel(CODEBREAKER_OPENING[variant], randomRelabeling(variant, random)));
  const planned = plannedGuess(variant, known);
  if (planned) return guessAction(planned);
  const space = codeSpace(variant);
  const candidates = consistentIndices(space, known);
  if (candidates.length === 0) return guessAction(cbRandomCode(variant, random));
  if (candidates.length <= 2) return guessAction(space.codes[candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]]);
  const deadline = performance.now() + SOLVE_LIMIT_MS;
  const guess = chooseGuessIndex(space, candidates, { expired: () => performance.now() > deadline });
  return guessAction(space.codes[guess]);
}

/** The smallest code that fits the seat's feedback: the last resort when the strategies keep failing. */
export function codeBreakerFirstLegalAction(visible: CodeBreakerVisibleState): BotAction | null {
  if (!owesGuess(visible)) return null;
  const [first] = consistentCodes(visible);
  return guessAction(first ?? codeSpace(visible.options.variant).codes[0]);
}
