import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const tenHalfStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ counts }) => (counts.handsPlayed ?? 0) > 0
    ? [{ id: 'busts', value: (counts.busts ?? 0) / counts.handsPlayed, format: 'rate', basis: counts.handsPlayed }] : [],
};
