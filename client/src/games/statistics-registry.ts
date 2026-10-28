import type { GameType } from '@shared/types';
import { rankingStatistics } from './game-statistics';
import type { GameStatisticsRules } from './game-statistics';
import { bridgeStatistics } from './bridge/statistics';
import { ninetyNineStatistics } from './ninetynine/statistics';
import { chinesePokerStatistics } from './chinesepoker/statistics';
import { liarsDeckStatistics } from './liarsdeck/statistics';
import { blackjackStatistics } from './blackjack/statistics';
import { holdemStatistics } from './holdem/statistics';
import { napoleonStatistics } from './napoleon/statistics';
import { tenHalfStatistics } from './tenhalf/statistics';
import { liarsDiceStatistics } from './liarsdice/statistics';
import { crazyEightsStatistics } from './crazyeights/statistics';

export const GAME_STATISTICS: Readonly<Record<GameType, GameStatisticsRules>> = {
  bridge: bridgeStatistics,
  bigtwo: rankingStatistics,
  redpoints: rankingStatistics,
  ninetynine: ninetyNineStatistics,
  sevens: rankingStatistics,
  chinesepoker: chinesePokerStatistics,
  liarsdeck: liarsDeckStatistics,
  blackjack: blackjackStatistics,
  holdem: holdemStatistics,
  napoleon: napoleonStatistics,
  tenhalf: tenHalfStatistics,
  liarsdice: liarsDiceStatistics,
  crazyeights: crazyEightsStatistics,
};

export function gameStatisticsRules(gameType: GameType): GameStatisticsRules {
  return GAME_STATISTICS[gameType];
}
