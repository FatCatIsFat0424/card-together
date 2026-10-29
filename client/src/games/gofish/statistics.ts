import { rankingStatistics } from '../game-statistics';
import type { GameStatisticsRules } from '../game-statistics';

/** Go Fish is a plain ranking game; its special records come from the shared definitions. */
export const goFishStatistics: GameStatisticsRules = rankingStatistics;
