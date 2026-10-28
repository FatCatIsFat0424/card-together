import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const chinesePokerStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ counts, matches }) => [{ id: 'fouls', value: (counts.fouls ?? 0) / matches, format: 'rate', basis: matches }],
};
