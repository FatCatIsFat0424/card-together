import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const liarsDiceStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ sums, matches }) => [{ id: 'diceLost', value: (sums.diceLost ?? 0) / matches, format: 'decimal', basis: matches }],
};
