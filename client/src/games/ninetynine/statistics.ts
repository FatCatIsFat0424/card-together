import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const ninetyNineStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ counts, matches }) => [{ id: 'firstOut', value: (counts.firstOut ?? 0) / matches, format: 'rate', basis: matches }],
};
