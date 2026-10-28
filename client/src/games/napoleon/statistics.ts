import type { GameStatisticsRules } from '../game-statistics';

/** Role baselines need this many server-wide observations; fewer fall back to a coin flip. */
export const ROLE_BASELINE_MIN = 20;
const ROLES = ['napoleon', 'secretary', 'defender'] as const;

export const napoleonStatistics: GameStatisticsRules = {
  expectedWins: (stats, baselines) => ROLES.reduce((sum, role) => {
    const baseline = baselines[role];
    const rate = baseline && baseline.played >= ROLE_BASELINE_MIN ? baseline.won / baseline.played : 0.5;
    return sum + (stats.counts[`role.${role}`] ?? 0) * rate;
  }, 0),
  metrics: () => [],
  roleMetrics: ROLES.map((role) => ({ label: `history.stats.role.${role}`, roles: [role] })),
};
