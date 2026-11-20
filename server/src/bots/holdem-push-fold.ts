import type { Card } from '@shared/types';
import { cardId } from './holdem-evaluator';
import { CALL_CHARTS, PUSH_CHARTS, PUSH_FOLD_ALPHABET } from './holdem-push-fold-data';
import { classIndexOfIds } from './holdem-preflop-table';

// Short-stack charts from an offline push/fold equilibrium (scripts/holdem-push-fold): for every starting-hand
// class, the deepest effective stack in big blinds at which it moves all-in first in, or calls such an all-in.

const ALWAYS = PUSH_FOLD_ALPHABET.length - 1;

function decode(chart: string): Float64Array {
  return Float64Array.from([...chart], (code) => {
    const value = PUSH_FOLD_ALPHABET.indexOf(code);
    return value === ALWAYS ? Number.POSITIVE_INFINITY : value / 2;
  });
}

const PUSH = PUSH_CHARTS.map(decode);
const CALL = CALL_CHARTS.map((charts) => charts.map(decode));

/** Most seats behind a first-in all-in that the charts cover. */
export const MAX_CHART_BEHIND = PUSH.length;

const clampBehind = (behind: number): number => Math.min(MAX_CHART_BEHIND, Math.max(1, Math.round(behind)));

/** Deepest effective stack (big blinds) at which the class of `first`/`second` (card ids) moves all-in first in. */
export function pushLimitOfIds(behind: number, first: number, second: number): number {
  return PUSH[clampBehind(behind) - 1][classIndexOfIds(first, second)];
}

export function pushLimit(behind: number, hole: readonly Card[]): number {
  return pushLimitOfIds(behind, cardId(hole[0]), cardId(hole[1]));
}

/**
 * Deepest effective stack at which the class calls a first-in all-in. `behind` counts the seats that were behind the
 * all-in; `place` is the caller's place among them (1 = next to act). Beyond the charted seats the blinds keep their
 * places at the end, and earlier seats read as the first one.
 */
export function callLimitOfIds(behind: number, place: number, first: number, second: number): number {
  const seats = clampBehind(behind);
  const fromEnd = Math.max(0, Math.round(behind) - Math.round(place));
  const index = Math.max(0, seats - 1 - fromEnd);
  return CALL[seats - 1][index][classIndexOfIds(first, second)];
}

export function callLimit(behind: number, place: number, hole: readonly Card[]): number {
  return callLimitOfIds(behind, place, cardId(hole[0]), cardId(hole[1]));
}
