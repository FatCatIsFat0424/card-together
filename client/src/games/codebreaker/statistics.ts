import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

export const codeBreakerStatistics: GameStatisticsRules = {
  ...rankingStatistics,
  metrics: ({ counts, sums }) => {
    const cracked = counts.codesCracked ?? 0;
    return cracked > 0 ? [{ id: 'averageGuesses', value: (sums.guessesToSolve ?? 0) / cracked, format: 'decimal', basis: cracked }] : [];
  },
};
