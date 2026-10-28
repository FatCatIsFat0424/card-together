import { createHash } from 'node:crypto';
import { GAME_SEAT_ORDER, GAME_TYPES } from '@shared/constants';
import { matchStanding } from '@shared/rules/match-standing';
import { DAILY_TASKS, DAILY_TASK_COUNT, isDailyTaskId } from '@shared/constants/daily-rewards';
import type { AnyGameState, DailyRewardsStatus, DailyTaskId, GameSeat, GameType, MatchResult, PlayerInfo } from '@shared/types';

/** Private account state. Old accounts need no migration or historical backfill. */
export interface DailyRewardsRecord {
  readonly day: string;
  readonly gameTypes: readonly GameType[];
  readonly wins: number;
  readonly claimedTasks: readonly DailyTaskId[];
  readonly checkInDays: readonly string[];
  readonly gameCounts?: Readonly<Partial<Record<GameType, number>>>;
  readonly taskIds?: readonly DailyTaskId[];
  readonly replacement?: { readonly from: DailyTaskId; readonly to: DailyTaskId };
}

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function dailyDate(now: number): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/** Stable per-account daily shuffle: refresh/restart never rerolls an assignment. */
function shuffledTasks(day: string, accountId: string): DailyTaskId[] {
  return DAILY_TASKS.map(({ id }) => ({ id,
    rank: createHash('sha256').update(`${day}:${accountId}:${id}`).digest('hex'),
  })).sort((a, b) => a.rank.localeCompare(b.rank)).map(({ id }) => id);
}

export function dailyState(record: DailyRewardsRecord | undefined, now: number, accountId: string): DailyRewardsRecord & {
  readonly taskIds: readonly DailyTaskId[]; readonly gameCounts: Readonly<Partial<Record<GameType, number>>>;
} {
  const day = dailyDate(now);
  const state = record?.day === day ? record : {
    day, gameTypes: [], wins: 0, claimedTasks: [], checkInDays: record?.checkInDays ?? [],
  };
  return { ...state,
    // Preserve already claimed rewards from the earlier two-task implementation.
    taskIds: state.taskIds ?? [...new Set([...state.claimedTasks, ...shuffledTasks(day, accountId)])].slice(0, DAILY_TASK_COUNT),
    gameCounts: state.gameCounts ?? Object.fromEntries(state.gameTypes.map((type) => [type, 1])),
  };
}

export function taskProgress(state: DailyRewardsRecord, id: DailyTaskId): number {
  if (id === 'play-variety') return Math.min(3, state.gameTypes.length);
  if (id === 'win-two') return state.wins;
  const counts = state.gameCounts ?? {};
  if (id === 'play-casino') return Math.min(1, (counts.blackjack ?? 0) + (counts.holdem ?? 0) + (counts.tenhalf ?? 0));
  const type = id.slice(5) as GameType;
  return Math.min(type === 'bridge' ? 1 : 2, counts[type] ?? 0);
}

export function replacementTask(state: DailyRewardsRecord, accountId: string): DailyTaskId {
  return shuffledTasks(state.day, accountId).find((id) => !state.taskIds?.includes(id))!;
}

export function dailyStatus(record: DailyRewardsRecord | undefined, now: number, accountId: string): DailyRewardsStatus {
  const state = dailyState(record, now, accountId);
  return { day: state.day, gameTypes: state.gameTypes, wins: state.wins, claimedTasks: state.claimedTasks, serverTime: now,
    tasks: state.taskIds.map((id) => ({ id, progress: taskProgress(state, id) })),
    swapsRemaining: state.replacement ? 0 : 1,
    resetsAt: (Math.floor((now + TAIPEI_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - TAIPEI_OFFSET_MS,
    checkInDays: state.checkInDays.filter((day) => day.startsWith(state.day.slice(0, 7))),
  };
}

/** Win rule shared with the match history: first place (ties included) or the winning side. */
export function gameWonByAccount(game: Pick<AnyGameState, 'players' | 'result'>, accountId: string): boolean {
  const players: Partial<Record<GameSeat, PlayerInfo>> = game.players;
  const seat = GAME_SEAT_ORDER.find((candidate) => players[candidate]?.id === accountId && !players[candidate]?.isBot);
  const { result } = game;
  if (!seat || !result) return false;
  // Bridge keeps its result without a discriminator while a game runs.
  const finished: MatchResult = 'gameType' in result ? result : { ...result, gameType: 'bridge' };
  return matchStanding(finished, seat)?.won ?? false;
}

export function dailyGameProgress(
  record: DailyRewardsRecord | undefined, game: Pick<AnyGameState, 'players' | 'gameType' | 'result'>, accountId: string, now: number,
): DailyRewardsRecord {
  const state = dailyState(record, now, accountId);
  if (!game.result || !Object.values(game.players).some((player) => player.id === accountId && !player.isBot)) return state;
  return { ...state, gameTypes: [...new Set([...state.gameTypes, game.gameType])],
    gameCounts: { ...state.gameCounts, [game.gameType]: Math.min(2, (state.gameCounts[game.gameType] ?? 0) + 1) },
    wins: Math.min(2, state.wins + Number(gameWonByAccount(game, accountId))) };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validDailyRewards(value: unknown): value is DailyRewardsRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const valid = validDate(record.day)
    && Array.isArray(record.gameTypes) && record.gameTypes.every((type: unknown) => GAME_TYPES.some((game) => game === type))
    && new Set(record.gameTypes).size === record.gameTypes.length
    && typeof record.wins === 'number' && Number.isInteger(record.wins) && record.wins >= 0 && record.wins <= 2
    && Array.isArray(record.claimedTasks)
    && record.claimedTasks.every((id: unknown) => DAILY_TASKS.some((task) => task.id === id))
    && new Set(record.claimedTasks).size === record.claimedTasks.length
    && (!record.claimedTasks.includes('play-variety') || record.gameTypes.length >= 3)
    && (!record.claimedTasks.includes('win-two') || record.wins >= 2)
    && Array.isArray(record.checkInDays) && record.checkInDays.every(validDate)
    && new Set(record.checkInDays).size === record.checkInDays.length;
  if (!valid) return false;
  if (record.gameCounts !== undefined && (!record.gameCounts || typeof record.gameCounts !== 'object'
    || Array.isArray(record.gameCounts) || !Object.entries(record.gameCounts).every(([type, count]: [string, unknown]) =>
      GAME_TYPES.some((game) => game === type) && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= 2))) return false;
  if (record.taskIds !== undefined && (!Array.isArray(record.taskIds) || record.taskIds.length !== DAILY_TASK_COUNT
    || !record.taskIds.every(isDailyTaskId) || new Set(record.taskIds).size !== DAILY_TASK_COUNT
    || !(record.claimedTasks as DailyTaskId[]).every((id) => (record.taskIds as unknown[]).includes(id)))) return false;
  if (record.replacement !== undefined) {
    if (!record.replacement || typeof record.replacement !== 'object') return false;
    const replacement = record.replacement as Record<string, unknown>;
    if (!isDailyTaskId(replacement.from) || !isDailyTaskId(replacement.to) || replacement.from === replacement.to
      || !Array.isArray(record.taskIds) || record.taskIds.includes(replacement.from) || !record.taskIds.includes(replacement.to)) return false;
  }
  const state = value as DailyRewardsRecord;
  return state.claimedTasks.every((id) => taskProgress(state, id) >= DAILY_TASKS.find((task) => task.id === id)!.target);
}
