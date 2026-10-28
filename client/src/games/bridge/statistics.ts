import type { GameStatisticsRules } from '../game-statistics';

export const bridgeStatistics: GameStatisticsRules = {
  expectedWins: (stats) => stats.matches / 2,
  metrics: ({ counts, sums }) => {
    const wins = (counts['won.declarer'] ?? 0) + (counts['won.partner'] ?? 0);
    return wins > 0 ? [{ id: 'overtricks', value: (sums.overtricks ?? 0) / wins, format: 'signed', basis: wins }] : [];
  },
  roleMetrics: [
    { label: 'history.stats.bridge.declarerSide', roles: ['declarer', 'partner'] },
    { label: 'history.stats.bridge.declarer', roles: ['declarer'] },
    { label: 'history.stats.bridge.defender', roles: ['defender'] },
  ],
};
