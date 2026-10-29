export const DAILY_TASKS = [
  { id: 'play-variety', target: 3, coins: 20 },
  { id: 'win-two', target: 2, coins: 10 },
  { id: 'play-bridge', target: 1, coins: 15 },
  { id: 'play-bigtwo', target: 2, coins: 15 },
  { id: 'play-redpoints', target: 2, coins: 15 },
  { id: 'play-ninetynine', target: 2, coins: 10 },
  { id: 'play-sevens', target: 2, coins: 15 },
  { id: 'play-chinesepoker', target: 2, coins: 15 },
  { id: 'play-liarsdeck', target: 2, coins: 10 },
  { id: 'play-liarsdice', target: 2, coins: 10 },
  { id: 'play-reversi', target: 2, coins: 10 },
  { id: 'play-oldmaid', target: 2, coins: 10 },
  { id: 'play-casino', target: 1, coins: 20 },
  { id: 'play-crazyeights', target: 2, coins: 15 },
  { id: 'play-gofish', target: 2, coins: 15 },
  { id: 'play-doudizhu', target: 2, coins: 15 },
] as const;

export const DAILY_TASK_COUNT = 3;
export const DAILY_CHECK_IN_COINS = 10;

export function isDailyTaskId(value: unknown): value is typeof DAILY_TASKS[number]['id'] {
  return DAILY_TASKS.some((task) => task.id === value);
}
