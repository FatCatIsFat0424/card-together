import type { GameType } from '../types/room';

/**
 * Daily slots in display order: a game-agnostic play task, a win or variety task, and a task for one of the
 * player's recent favorite games (another play task for players without recent matches).
 */
export const DAILY_TASK_SLOTS = ['play', 'challenge', 'favorite'] as const;
export type DailyTaskPool = typeof DAILY_TASK_SLOTS[number];

/**
 * Entries without a pool are retired: they stay valid for receipts and assignments saved before the redesign,
 * so stored records keep loading, but they are never drawn again.
 */
export const DAILY_TASKS = [
  { id: 'play-any-2', pool: 'play', target: 2, coins: 10 },
  { id: 'play-any-3', pool: 'play', target: 3, coins: 15 },
  { id: 'play-any-4', pool: 'play', target: 4, coins: 20 },
  { id: 'win-two', pool: 'challenge', target: 2, coins: 15 },
  { id: 'play-two-kinds', pool: 'challenge', target: 2, coins: 15 },
  { id: 'play-with-humans', pool: 'challenge', target: 1, coins: 15 },
  { id: 'play-bridge', pool: 'favorite', gameType: 'bridge', target: 1, coins: 15 },
  { id: 'play-bigtwo', pool: 'favorite', gameType: 'bigtwo', target: 2, coins: 15 },
  { id: 'play-redpoints', pool: 'favorite', gameType: 'redpoints', target: 2, coins: 15 },
  { id: 'play-ninetynine', pool: 'favorite', gameType: 'ninetynine', target: 2, coins: 10 },
  { id: 'play-sevens', pool: 'favorite', gameType: 'sevens', target: 2, coins: 15 },
  { id: 'play-chinesepoker', pool: 'favorite', gameType: 'chinesepoker', target: 2, coins: 15 },
  { id: 'play-liarsdeck', pool: 'favorite', gameType: 'liarsdeck', target: 2, coins: 10 },
  { id: 'play-blackjack', pool: 'favorite', gameType: 'blackjack', target: 1, coins: 15 },
  { id: 'play-holdem', pool: 'favorite', gameType: 'holdem', target: 1, coins: 15 },
  { id: 'play-napoleon', pool: 'favorite', gameType: 'napoleon', target: 2, coins: 15 },
  { id: 'play-tenhalf', pool: 'favorite', gameType: 'tenhalf', target: 1, coins: 15 },
  { id: 'play-liarsdice', pool: 'favorite', gameType: 'liarsdice', target: 2, coins: 10 },
  { id: 'play-crazyeights', pool: 'favorite', gameType: 'crazyeights', target: 2, coins: 15 },
  { id: 'play-stud', pool: 'favorite', gameType: 'stud', target: 1, coins: 15 },
  { id: 'play-reversi', pool: 'favorite', gameType: 'reversi', target: 2, coins: 10 },
  { id: 'play-oldmaid', pool: 'favorite', gameType: 'oldmaid', target: 2, coins: 10 },
  { id: 'play-gofish', pool: 'favorite', gameType: 'gofish', target: 2, coins: 15 },
  { id: 'play-doudizhu', pool: 'favorite', gameType: 'doudizhu', target: 2, coins: 15 },
  { id: 'play-jungle', pool: 'favorite', gameType: 'jungle', target: 2, coins: 10 },
  { id: 'play-gomoku', pool: 'favorite', gameType: 'gomoku', target: 2, coins: 10 },
  { id: 'play-xiangqi', pool: 'favorite', gameType: 'xiangqi', target: 2, coins: 15 },
  { id: 'play-banqi', pool: 'favorite', gameType: 'banqi', target: 2, coins: 10 },
  { id: 'play-chinesecheckers', pool: 'favorite', gameType: 'chinesecheckers', target: 2, coins: 10 },
  { id: 'play-landbattle', pool: 'favorite', gameType: 'landbattle', target: 2, coins: 15 },
  { id: 'play-variety', target: 3, coins: 20 },
  { id: 'play-casino', target: 1, coins: 20 },
] as const satisfies readonly {
  readonly id: string; readonly pool?: DailyTaskPool; readonly gameType?: GameType;
  readonly target: number; readonly coins: number;
}[];

export type DailyTaskDefinition = typeof DAILY_TASKS[number];

export const DAILY_TASK_COUNT = DAILY_TASK_SLOTS.length;
export const DAILY_CHECK_IN_COINS = 10;

export function isDailyTaskId(value: unknown): value is DailyTaskDefinition['id'] {
  return DAILY_TASKS.some((task) => task.id === value);
}

export function dailyTask(id: DailyTaskDefinition['id']): DailyTaskDefinition {
  return DAILY_TASKS.find((task) => task.id === id)!;
}

/** The game a per-game task counts, or undefined for game-agnostic and retired tasks. */
export function dailyTaskGame(id: DailyTaskDefinition['id']): GameType | undefined {
  const task: DailyTaskDefinition = dailyTask(id);
  return 'gameType' in task ? task.gameType : undefined;
}

/** The favorite-pool task for a game; every game type has exactly one. */
export function favoriteTaskFor(gameType: GameType): DailyTaskDefinition['id'] {
  return DAILY_TASKS.find((task) => 'pool' in task && task.pool === 'favorite' && task.gameType === gameType)!.id;
}

/** Drawable tasks of a slot pool, in catalog order. */
export function dailyTaskPool(pool: DailyTaskPool): readonly DailyTaskDefinition['id'][] {
  return DAILY_TASKS.filter((task) => 'pool' in task && task.pool === pool).map((task) => task.id);
}
