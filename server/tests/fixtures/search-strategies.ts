// Test-only search strategies run inside pool workers; each exercises one pool behaviour.
import { redPointsFirstLegalAction } from '../../src/bots/fallback-actions';
import type { BotAction } from '../../src/bots/bot-decisions';
import type { SearchContext } from '../../src/bots/search/search-types';

/** Reports the seeded sequence and the limits it received; depends on nothing but its inputs. */
export function echoSearch(_visible: unknown, context: SearchContext): BotAction {
  const numbers = [context.random(), context.random(), context.random()];
  return {
    type: 'liarsdeck-play',
    cardIds: [Math.floor(numbers[0] * 1e9), Math.floor(numbers[1] * 1e9), Math.floor(numbers[2] * 1e9),
      context.budget.maxDepth ?? -1],
  };
}

/** A legal Red Points move chosen by a search that spends a little of its budget. */
export function redPointsSearch(visible: unknown, context: SearchContext): BotAction | null {
  const until = performance.now() + 20;
  while (performance.now() < until && !context.budget.expired()) { /* simulated search work */ }
  return redPointsFirstLegalAction(visible as Parameters<typeof redPointsFirstLegalAction>[0]);
}

/** Holds the thread for the given milliseconds (read from the view), then answers. */
export function sleepSearch(visible: unknown): BotAction {
  const wait = (visible as { waitMs?: number }).waitMs ?? 0;
  const until = performance.now() + wait;
  while (performance.now() < until) { /* hold the thread */ }
  return { type: 'bigtwo-pass' };
}

/** Never returns, as a runaway search would. */
export function spinSearch(): BotAction {
  for (;;) { /* never yields */ }
}

/** Ends its thread without a result. */
export function crashSearch(): BotAction {
  process.exit(1);
}

export function throwSearch(): BotAction {
  throw new Error('search exploded');
}

/** Allocates until the worker's heap cap stops it. */
export function memorySearch(): BotAction {
  const hoard: number[][] = [];
  for (;;) hoard.push(new Array<number>(1_000_000).fill(1));
}

export const notAFunction = 7;
