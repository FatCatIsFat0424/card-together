import { ACHIEVEMENT_CATEGORIES } from '@shared/constants/achievements';
import { GAME_TYPES } from '@shared/constants';
import type { AchievementsStatus, AnyGameState, GameType } from '@shared/types';
import type { AccountRecord } from './repository';
import { gameWonByAccount } from './daily-rewards';

export interface AchievementsRecord {
  readonly games: number;
  readonly wins: number;
  readonly gameTypes: readonly GameType[];
  readonly dailyTasks: number;
}

export function achievementState(record: AchievementsRecord | undefined): AchievementsRecord {
  return record ?? { games: 0, wins: 0, gameTypes: [], dailyTasks: 0 };
}

export function achievementGameProgress(record: AchievementsRecord | undefined,
  game: Pick<AnyGameState, 'players' | 'gameType' | 'result'>, accountId: string): AchievementsRecord {
  const state = achievementState(record);
  if (!game.result || !Object.values(game.players).some((player) => player.id === accountId && !player.isBot)) return state;
  return { ...state, games: state.games + 1,
    wins: state.wins + Number(gameWonByAccount(game, accountId)),
    gameTypes: [...new Set([...state.gameTypes, game.gameType])] };
}

export function achievementsStatus(account: AccountRecord): AchievementsStatus {
  const state = achievementState(account.achievements);
  const metrics = { ...state, variants: state.gameTypes.length, checkIns: account.dailyRewards?.checkInDays.length ?? 0 };
  return { categories: ACHIEVEMENT_CATEGORIES.map((category) => ({
    id: category.id, claimed: account.ownedAchievementNameplates?.includes(category.reward) ?? false,
    items: category.items.map((item) => ({ id: item.id, progress: Math.min(item.target, metrics[item.metric]) })),
  })) };
}

export function validAchievements(value: unknown): value is AchievementsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  const count = (value: unknown, max: number): boolean => typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0 && value <= max;
  return count(state.games, Number.MAX_SAFE_INTEGER) && count(state.wins, Number.MAX_SAFE_INTEGER)
    && count(state.dailyTasks, Number.MAX_SAFE_INTEGER)
    && Number(state.wins) <= Number(state.games)
    && Array.isArray(state.gameTypes) && state.gameTypes.length <= Number(state.games)
    && state.gameTypes.every((type: unknown) => GAME_TYPES.some((game) => game === type))
    && new Set(state.gameTypes).size === state.gameTypes.length;
}
