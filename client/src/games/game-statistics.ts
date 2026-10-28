import type { GameStats, RoleTally } from '@shared/types';
import type { StandingRole } from '@shared/rules/match-standing';
import type { GameMetric } from '../match-statistics';
import type { TranslationKey } from '../i18n';

export interface RoleMetricDefinition {
  readonly label: TranslationKey;
  readonly roles: readonly StandingRole[];
}

/** Pure statistics hooks; components only format the figures and role groups returned here. */
export interface GameStatisticsRules {
  readonly expectedWins: (stats: GameStats, baselines: Readonly<Partial<Record<string, RoleTally>>>) => number;
  readonly metrics: (stats: GameStats) => readonly GameMetric[];
  readonly roleMetrics: readonly RoleMetricDefinition[];
}

export const rankingStatistics: GameStatisticsRules = {
  expectedWins: (stats) => Object.entries(stats.tables).reduce((sum, [players, count]) => sum + count / Number(players), 0),
  metrics: () => [],
  roleMetrics: [],
};
