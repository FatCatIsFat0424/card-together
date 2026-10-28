import type { VisibleStateOf } from '@shared/games/game-definition';
import type { GameType } from '@shared/types';
import type { BotAction } from '../bot-decisions';

/** Limits a search strategy must respect; the pool still terminates a worker that overruns them. */
export interface SearchBudget {
  /** Deepest ply the strategy may search; undefined means only the clock limits it. */
  readonly maxDepth: number | undefined;
  /** Milliseconds left of the wall-clock budget; never negative. */
  readonly timeLeftMs: () => number;
  /** True once the wall-clock budget is spent; iterative deepening stops and returns its best result so far. */
  readonly expired: () => boolean;
}

export interface SearchContext {
  /** Seeded generator: equal seeds give equal sequences, so a depth-bounded search is reproducible. */
  readonly random: () => number;
  readonly budget: SearchBudget;
}

/**
 * Pure and synchronous: reads only the seat's own filtered view. Runs inside a worker, so it may block
 * its thread for the whole budget but must not touch manager state, I/O, or the main thread's modules.
 */
export type SearchStrategy<K extends GameType = GameType> = (
  visible: VisibleStateOf<K>, context: SearchContext,
) => BotAction | null;

/** Where a worker finds a strategy: a module URL and the name of its exported function. */
export interface SearchStrategyRef<K extends GameType = GameType> {
  readonly module: string;
  readonly exportName: string;
  /** Type-level link to the game; never present at runtime. */
  readonly game?: K;
}

/** A game bot's opt-in to the worker pool for its hard difficulty. */
export interface SearchBotSpec<K extends GameType = GameType> {
  readonly strategy: SearchStrategyRef<K>;
  /** Wall-clock budget for one decision. */
  readonly budgetMs: number;
  readonly maxDepth?: number;
}

/**
 * Names a search strategy exported by a module next to the caller, for example
 * `searchStrategy<'xiangqi'>(new URL('./xiangqi-search.ts', import.meta.url), 'xiangqiSearch')`.
 */
export function searchStrategy<K extends GameType>(module: URL, exportName: string): SearchStrategyRef<K> {
  return { module: module.href, exportName };
}

/** Structured-cloneable request handed to the pool. */
export interface SearchTask {
  readonly strategy: SearchStrategyRef;
  /** The seat's filtered view; plain data only. */
  readonly visible: unknown;
  readonly budgetMs: number;
  readonly maxDepth?: number;
  /** Unsigned 32-bit seed for the strategy's generator. */
  readonly seed: number;
}

export type SearchFailure = 'timeout' | 'crashed' | 'failed' | 'rejected' | 'cancelled' | 'closed';

/** The pool never rejects: every non-`ok` outcome means the caller should use its synchronous fallback. */
export type SearchOutcome =
  | { readonly status: 'ok'; readonly action: BotAction | null; readonly elapsedMs: number }
  | { readonly status: SearchFailure; readonly reason?: string };

/** The part of the pool that bot scheduling depends on. */
export interface SearchRunner {
  readonly run: (task: SearchTask, signal?: AbortSignal) => Promise<SearchOutcome>;
}

/** Messages between the pool and a worker. */
export interface WorkerRequest {
  readonly id: number;
  readonly task: SearchTask;
}

export type WorkerMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'result'; readonly id: number; readonly action: BotAction | null }
  | { readonly type: 'error'; readonly id: number; readonly reason: string };
