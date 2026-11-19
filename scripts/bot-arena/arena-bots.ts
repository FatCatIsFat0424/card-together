import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import type { GameType, PlayerVisibleGameState } from '@shared/types';
import type { BotAction } from '../../server/src/bots/bot-decisions';
import type { SearchContext } from '../../server/src/bots/search/search-types';

/** One side's bot for one game, loaded from a source tree. */
export interface ArenaBot {
  /** The production decision: the game's search strategy when it declares one, otherwise its hard strategy. */
  readonly decide: (visible: PlayerVisibleGameState, random: () => number) => BotAction | null;
  /** The registry's simple legal move, used when `decide` fails. */
  readonly firstLegal: (visible: PlayerVisibleGameState) => BotAction | null;
  /** Search budget per decision; null for a synchronous hard strategy. */
  readonly budgetMs: number | null;
}

type Decide = ArenaBot['decide'];
type Strategy = (visible: PlayerVisibleGameState, context: SearchContext) => BotAction | null;

function field(value: unknown, key: string, where: string): unknown {
  if (typeof value !== 'object' || value === null) throw new Error(`${where} is not an object.`);
  return (value as Record<string, unknown>)[key];
}

function callable<T>(value: unknown, where: string): T {
  if (typeof value !== 'function') throw new Error(`${where} is not a function.`);
  return value as T;
}

/** The same budget the search worker gives a strategy, measured from the start of the call. */
function searchContext(random: () => number, budgetMs: number, maxDepth: number | undefined): SearchContext {
  const deadline = performance.now() + budgetMs;
  return {
    random,
    budget: {
      maxDepth,
      timeLeftMs: () => Math.max(0, deadline - performance.now()),
      expired: () => performance.now() >= deadline,
    },
  };
}

/**
 * Loads `gameType`'s bot from the registry under `root` (`server/src/bots/bot-registry.ts`). The registry
 * is read structurally, so a baseline from before or after an interface change still loads as long as it
 * has `decide` (named `hard` before the easy bot was removed), `firstLegal`, and optionally `search`.
 * `budgetMs` overrides the registry budget.
 */
export async function loadArenaBot(root: string, gameType: GameType, budgetMs?: number): Promise<ArenaBot> {
  const registryUrl = pathToFileURL(join(root, 'server/src/bots/bot-registry.ts')).href;
  const registry: unknown = await import(registryUrl);
  const entry = field(field(registry, 'GAME_BOTS', registryUrl), gameType, `GAME_BOTS in ${registryUrl}`);
  const where = `GAME_BOTS.${gameType} in ${registryUrl}`;
  const name = typeof entry === 'object' && entry !== null && 'decide' in entry ? 'decide' : 'hard';
  const hard = callable<Decide>(field(entry, name, where), `${where}.${name}`);
  const firstLegal = callable<ArenaBot['firstLegal']>(field(entry, 'firstLegal', where), `${where}.firstLegal`);
  const search = field(entry, 'search', where);
  if (search === undefined) return { decide: hard, firstLegal, budgetMs: null };

  const ref = field(search, 'strategy', `${where}.search`);
  const module = field(ref, 'module', `${where}.search.strategy`);
  const exportName = field(ref, 'exportName', `${where}.search.strategy`);
  const declaredBudget = field(search, 'budgetMs', `${where}.search`);
  const maxDepth = field(search, 'maxDepth', `${where}.search`);
  if (typeof module !== 'string' || typeof exportName !== 'string' || typeof declaredBudget !== 'number'
    || (maxDepth !== undefined && typeof maxDepth !== 'number')) {
    throw new Error(`${where}.search has an unexpected shape.`);
  }
  const strategy = callable<Strategy>(field(await import(module), exportName, module), `${module}#${exportName}`);
  const budget = budgetMs ?? declaredBudget;
  return {
    decide: (visible, random) => strategy(visible, searchContext(random, budget, maxDepth)),
    firstLegal,
    budgetMs: budget,
  };
}
