import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const battleshipStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ sums }) => {
    const shots = sums.shotsFired ?? 0;
    return shots > 0 ? [{ id: 'accuracy', value: (sums.shotsHit ?? 0) / shots, format: 'rate', basis: shots }] : [];
  },
};
