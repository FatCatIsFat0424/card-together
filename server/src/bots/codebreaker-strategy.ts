import type { CodeBreakerVisibleState } from '@shared/types';
import {
  CB_MAX_GUESSES, CB_SLOTS, cbAllCodes, cbConsistent, cbFeedback, cbRandomCode, cbSymbolCount,
} from '@shared/rules/codebreaker';
import type { CbCode, CbKnownGuess, CbVariant } from '@shared/rules/codebreaker';
import type { BotAction } from './bot-decisions';

/** Consistent codes the hard bot considers guessing. */
const POOL_SIZE = 80;

/** Codes outside the consistent set tried as pure probes while the set is still large. */
const PROBE_SIZE = 80;

/** Consistent codes the hard bot scores each guess against. */
const TARGET_SIZE = 400;

/** Below this many consistent codes every guess is a candidate: probes cannot beat a direct try. */
const PROBE_THRESHOLD = 8;

const allCodesCache = new Map<CbVariant, readonly CbCode[]>();

/** Every code of a variant, built on first use because 5,040 arrays are not worth creating at import. */
function allCodes(variant: CbVariant): readonly CbCode[] {
  let codes = allCodesCache.get(variant);
  if (!codes) {
    codes = cbAllCodes(variant);
    allCodesCache.set(variant, codes);
  }
  return codes;
}

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
  const codes = allCodes(visible.options.variant);
  return known.length === 0 ? codes : codes.filter((code) => cbConsistent(code, known));
}

/** Up to `count` distinct items of `items`, chosen uniformly. */
function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  if (items.length <= count) return [...items];
  const copy = [...items];
  for (let index = 0; index < count; index++) {
    const swap = index + Math.min(copy.length - index - 1, Math.floor(random() * (copy.length - index)));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy.slice(0, count);
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/** Colour codes open best with two pairs (1122); any symbols will do since colours are interchangeable. */
function openingCode(variant: CbVariant, random: () => number): CbCode {
  if (variant === 'digits') return cbRandomCode(variant, random);
  const [first, second] = sample(Array.from({ length: cbSymbolCount(variant) }, (_, symbol) => symbol), 2, random);
  return [first, first, second, second];
}

/**
 * Sum of squared bucket sizes of the feedback each target would give; smaller means the guess splits the
 * remaining candidates more evenly. The bucket that wins outright costs nothing.
 */
function partitionCost(guess: CbCode, targets: readonly CbCode[]): number {
  const buckets = new Map<number, number>();
  for (const target of targets) {
    const feedback = cbFeedback(target, guess);
    if (feedback.exact === CB_SLOTS) continue;
    const key = feedback.exact * (CB_SLOTS + 1) + feedback.partial;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let cost = 0;
  for (const size of buckets.values()) cost += size * size;
  return cost;
}

/**
 * A random code that fits the seat's own feedback: what the easy bot guesses and what a seat that ran out
 * of time gets.
 */
export function easyCodeBreakerAction(visible: CodeBreakerVisibleState, random: () => number): BotAction | null {
  if (!owesGuess(visible)) return null;
  const candidates = consistentCodes(visible);
  return guessAction(candidates.length > 0 ? pick(candidates, random) : cbRandomCode(visible.options.variant, random));
}

/**
 * Hard bot: keeps every code consistent with its own feedback and guesses the one (or, while many remain, a
 * probe) whose feedback would split a sample of those codes most evenly. It sees nothing but its own guesses.
 */
export function getCodeBreakerBotAction(visible: CodeBreakerVisibleState, random: () => number): BotAction | null {
  if (!owesGuess(visible)) return null;
  const variant = visible.options.variant;
  const candidates = consistentCodes(visible);
  if (candidates.length === 0) return guessAction(cbRandomCode(variant, random));
  if (knownGuesses(visible).length === 0) return guessAction(openingCode(variant, random));
  if (candidates.length <= 2) return guessAction(pick(candidates, random));

  const targets = sample(candidates, TARGET_SIZE, random);
  const pool = sample(candidates, POOL_SIZE, random);
  if (candidates.length > PROBE_THRESHOLD) pool.push(...sample(allCodes(variant), PROBE_SIZE, random));
  let best = pool[0];
  let bestCost = Infinity;
  for (const guess of pool) {
    const cost = partitionCost(guess, targets);
    if (cost < bestCost) {
      best = guess;
      bestCost = cost;
    }
  }
  return guessAction(best);
}

/** The smallest code that fits the seat's feedback: the last resort when the strategies keep failing. */
export function codeBreakerFirstLegalAction(visible: CodeBreakerVisibleState): BotAction | null {
  if (!owesGuess(visible)) return null;
  const [first] = consistentCodes(visible);
  return guessAction(first ?? allCodes(visible.options.variant)[0]);
}
