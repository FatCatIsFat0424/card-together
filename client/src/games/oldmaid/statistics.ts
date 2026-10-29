import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const oldMaidStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ sums, matches }) => [{ id: 'jokerLosses', value: (sums.jokerLosses ?? 0) / matches, format: 'decimal', basis: matches }],
};
