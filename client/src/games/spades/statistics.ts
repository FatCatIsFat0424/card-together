import type { GameStatisticsRules } from '../game-statistics';
export const spadesStatistics: GameStatisticsRules = { expectedWins: (stats) => stats.matches / 2,
  metrics: () => [], roleMetrics: [] };
