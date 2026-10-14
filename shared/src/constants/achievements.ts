export const ACHIEVEMENT_CATEGORIES = [
  { id: 'table', reward: 'nameplate-table-traveler', items: [
    { id: 'first-game', metric: 'games', target: 1 },
    { id: 'twenty-games', metric: 'games', target: 20 },
    { id: 'five-variants', metric: 'variants', target: 5 },
    { id: 'five-wins', metric: 'wins', target: 5 },
    { id: 'fifty-wins', metric: 'wins', target: 50 },
    { id: 'hundred-wins', metric: 'wins', target: 100 },
    { id: 'two-fifty-wins', metric: 'wins', target: 250 },
    { id: 'hundred-games', metric: 'games', target: 100 },
    { id: 'two-hundred-games', metric: 'games', target: 200 },
    { id: 'five-hundred-games', metric: 'games', target: 500 },
    { id: 'thousand-games', metric: 'games', target: 1000 },
  ] },
  { id: 'daily', reward: 'nameplate-daily-collector', items: [
    { id: 'first-check-in', metric: 'checkIns', target: 1 },
    { id: 'seven-check-ins', metric: 'checkIns', target: 7 },
    { id: 'three-tasks', metric: 'dailyTasks', target: 3 },
    { id: 'fifteen-tasks', metric: 'dailyTasks', target: 15 },
    { id: 'thirty-check-ins', metric: 'checkIns', target: 30 },
    { id: 'sixty-check-ins', metric: 'checkIns', target: 60 },
    { id: 'ninety-check-ins', metric: 'checkIns', target: 90 },
    { id: 'half-year-check-ins', metric: 'checkIns', target: 180 },
    { id: 'forty-five-tasks', metric: 'dailyTasks', target: 45 },
    { id: 'ninety-tasks', metric: 'dailyTasks', target: 90 },
    { id: 'one-thirty-five-tasks', metric: 'dailyTasks', target: 135 },
    { id: 'two-seventy-tasks', metric: 'dailyTasks', target: 270 },
  ] },
] as const;

export type AchievementCategoryId = typeof ACHIEVEMENT_CATEGORIES[number]['id'];
export type AchievementId = typeof ACHIEVEMENT_CATEGORIES[number]['items'][number]['id'];

export function isAchievementCategoryId(value: unknown): value is AchievementCategoryId {
  return ACHIEVEMENT_CATEGORIES.some((category) => category.id === value);
}
