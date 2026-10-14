export const ACHIEVEMENT_CATEGORIES = [
  { id: 'table', reward: 'nameplate-table-traveler', items: [
    { id: 'first-game', metric: 'games', target: 1 },
    { id: 'twenty-games', metric: 'games', target: 20 },
    { id: 'five-variants', metric: 'variants', target: 5 },
    { id: 'five-wins', metric: 'wins', target: 5 },
  ] },
  { id: 'daily', reward: 'nameplate-daily-collector', items: [
    { id: 'first-check-in', metric: 'checkIns', target: 1 },
    { id: 'seven-check-ins', metric: 'checkIns', target: 7 },
    { id: 'three-tasks', metric: 'dailyTasks', target: 3 },
    { id: 'fifteen-tasks', metric: 'dailyTasks', target: 15 },
  ] },
] as const;

export type AchievementCategoryId = typeof ACHIEVEMENT_CATEGORIES[number]['id'];
export type AchievementId = typeof ACHIEVEMENT_CATEGORIES[number]['items'][number]['id'];

export function isAchievementCategoryId(value: unknown): value is AchievementCategoryId {
  return ACHIEVEMENT_CATEGORIES.some((category) => category.id === value);
}
