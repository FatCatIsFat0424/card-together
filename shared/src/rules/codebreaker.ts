// ─── Code Breaker rules: a shared secret code, cracked by simultaneous guesses with exact/partial feedback ───

import type { GameSeat } from '../types/player';

/** `digits` is 1A2B (distinct digits 0–9); `colors` uses six colours with repeats allowed. */
export type CbVariant = 'digits' | 'colors';

export const CB_VARIANTS: readonly CbVariant[] = ['digits', 'colors'];

/** Room rules chosen before the match. */
export interface CodeBreakerOptions {
  readonly variant: CbVariant;
}

export const DEFAULT_CODEBREAKER_OPTIONS: CodeBreakerOptions = { variant: 'digits' };

export function isCodeBreakerOptions(value: unknown): value is CodeBreakerOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 && (CB_VARIANTS as readonly unknown[]).includes(candidate.variant);
}

/** Pegs in a code */
export const CB_SLOTS = 4;

/** Guesses one player may use */
export const CB_MAX_GUESSES = 10;

/** A code: `CB_SLOTS` symbols, each a digit 0–9 or a colour index 0–5. */
export type CbCode = readonly number[];

/** Right symbol in the right slot, and right symbol in a wrong slot. */
export interface CbFeedback {
  readonly exact: number;
  readonly partial: number;
}

/** Distinct symbols a variant draws from. */
export function cbSymbolCount(variant: CbVariant): number {
  return variant === 'digits' ? 10 : 6;
}

/** Well-formed means the right length, symbols in range, and (digits only) no repeated digit. */
export function isCbCode(value: unknown, variant: CbVariant): value is CbCode {
  if (!Array.isArray(value) || value.length !== CB_SLOTS) return false;
  const symbols = cbSymbolCount(variant);
  if (!value.every((symbol: unknown) => Number.isInteger(symbol) && (symbol as number) >= 0 && (symbol as number) < symbols)) {
    return false;
  }
  return variant === 'colors' || new Set(value).size === CB_SLOTS;
}

/** Scratch tallies reused across calls, because bots score tens of thousands of guesses per decision. */
const secretCounts = new Uint8Array(10);
const guessCounts = new Uint8Array(10);

export function cbFeedback(secret: CbCode, guess: CbCode): CbFeedback {
  let exact = 0;
  secretCounts.fill(0);
  guessCounts.fill(0);
  for (let slot = 0; slot < CB_SLOTS; slot++) {
    if (secret[slot] === guess[slot]) exact++;
    secretCounts[secret[slot]]++;
    guessCounts[guess[slot]]++;
  }
  let common = 0;
  for (let symbol = 0; symbol < 10; symbol++) common += Math.min(secretCounts[symbol], guessCounts[symbol]);
  return { exact, partial: common - exact };
}

export const cbSolved = (feedback: CbFeedback): boolean => feedback.exact === CB_SLOTS;

export const cbSameFeedback = (a: CbFeedback, b: CbFeedback): boolean => a.exact === b.exact && a.partial === b.partial;

/** Every well-formed code of a variant in ascending order: 5,040 for digits and 1,296 for colours. */
export function cbAllCodes(variant: CbVariant): CbCode[] {
  const symbols = cbSymbolCount(variant);
  const codes: CbCode[] = [];
  const build = (prefix: number[]): void => {
    if (prefix.length === CB_SLOTS) {
      codes.push(prefix);
      return;
    }
    for (let symbol = 0; symbol < symbols; symbol++) {
      if (variant === 'digits' && prefix.includes(symbol)) continue;
      build([...prefix, symbol]);
    }
  };
  build([]);
  return codes;
}

/** A guess with its feedback, as one seat knows it. */
export interface CbKnownGuess {
  readonly code: CbCode;
  readonly exact: number;
  readonly partial: number;
}

/** Whether `candidate` could be the secret given the feedback already seen. */
export function cbConsistent(candidate: CbCode, known: readonly CbKnownGuess[]): boolean {
  return known.every((entry) => cbSameFeedback(cbFeedback(candidate, entry.code), entry));
}

/** A uniformly random code; `random` returns values in [0, 1). */
export function cbRandomCode(variant: CbVariant, random: () => number): CbCode {
  const symbols = cbSymbolCount(variant);
  const code: number[] = [];
  while (code.length < CB_SLOTS) {
    const symbol = Math.min(symbols - 1, Math.floor(random() * symbols));
    if (variant === 'digits' && code.includes(symbol)) continue;
    code.push(symbol);
  }
  return code;
}

/** One seat's finish: guesses used and whether it cracked the code. */
export interface CbFinish {
  readonly seat: GameSeat;
  readonly guesses: number;
  readonly solved: boolean;
}

/**
 * Solvers rank by fewest guesses and share a rank on equal counts; everyone who did not solve ties for last,
 * after all solvers.
 */
export function cbRank(finishes: readonly CbFinish[], seat: GameSeat): number {
  const own = finishes.find((finish) => finish.seat === seat);
  if (!own) return finishes.length + 1;
  const solvers = finishes.filter((finish) => finish.solved);
  if (!own.solved) return solvers.length + 1;
  return solvers.filter((finish) => finish.guesses < own.guesses).length + 1;
}

/** Solvers with the fewest guesses; nobody wins when nobody solved. */
export function cbWinners(finishes: readonly CbFinish[]): GameSeat[] {
  const solvers = finishes.filter((finish) => finish.solved);
  if (solvers.length === 0) return [];
  const fewest = Math.min(...solvers.map((finish) => finish.guesses));
  return solvers.filter((finish) => finish.guesses === fewest).map((finish) => finish.seat);
}

/** Shortest round window; longer room timers give longer windows (base plus reserve). */
export const CB_MIN_ROUND_SECONDS = 20;

export function cbRoundSeconds(baseSeconds: number, bankSeconds: number): number {
  return Math.max(CB_MIN_ROUND_SECONDS, baseSeconds + bankSeconds);
}
