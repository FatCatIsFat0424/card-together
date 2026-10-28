import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const liarsDeckStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ sums, matches }) => [{ id: 'shots', value: (sums.shots ?? 0) / matches, format: 'decimal', basis: matches }],
};
