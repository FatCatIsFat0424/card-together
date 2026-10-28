import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const studStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ counts }) => (counts.showdowns ?? 0) > 0
    ? [{ id: 'showdownWins', value: (counts.showdownWins ?? 0) / counts.showdowns, format: 'rate', basis: counts.showdowns }] : [],
};
