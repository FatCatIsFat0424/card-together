import { createHash } from 'node:crypto';
import { GAME_SEAT_ORDER, GAME_TYPES } from '@shared/constants';
import { matchStanding } from '@shared/rules/match-standing';
import {
  DAILY_TASK_COUNT, DAILY_TASK_SLOTS, dailyTask, dailyTaskGame, dailyTaskPool, favoriteTaskFor, isDailyTaskId,
} from '@shared/constants/daily-rewards';
import type { DailyTaskPool } from '@shared/constants/daily-rewards';
import type {
  AnyGameState, DailyRewardsStatus, DailyTaskId, GameSeat, GameType, MatchResult, PlayerInfo,
} from '@shared/types';

/** Private account state. Old accounts need no migration or historical backfill. */
export interface DailyRewardsRecord {
  readonly day: string;
  readonly gameTypes: readonly GameType[];
  readonly wins: number;
  readonly claimedTasks: readonly DailyTaskId[];
  readonly checkInDays: readonly string[];
  readonly gameCounts?: Readonly<Partial<Record<GameType, number>>>;
  /** Completed games today, capped at the largest any-game target; absent in records from before the slots. */
  readonly matches?: number;
  /** Completed games today with another human seated, capped at its task target. */
  readonly humanMatches?: number;
  /** In slot order (`DAILY_TASK_SLOTS`); records from before the slots may hold retired IDs until the reset. */
  readonly taskIds?: readonly DailyTaskId[];
  /** The assigned task that was drawn from the recent favorite games. */
  readonly favoriteTask?: DailyTaskId;
  readonly replacement?: { readonly from: DailyTaskId; readonly to: DailyTaskId };
}

/** Matches per game type in the favorite window. */
export type RecentGameCounts = Readonly<Partial<Record<GameType, number>>>;
/** Reads the favorite window lazily: only drawing or replacing today's tasks needs it. */
export type RecentGames = () => RecentGameCounts;

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const FAVORITE_WINDOW_DAYS = 14;
/** Only the most-played games count as favorites; each is weighted by its match count. */
const FAVORITE_GAME_LIMIT = 3;
const WIN_CAP = 2;
const GAME_COUNT_CAP = 2;
const MATCH_CAP = Math.max(...dailyTaskPool('play').map((id) => dailyTask(id).target));
const HUMAN_MATCH_CAP = dailyTask('play-with-humans').target;

export function dailyDate(now: number): string {
  return new Date(now + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

function dayStart(now: number): number {
  return Math.floor((now + TAIPEI_OFFSET_MS) / DAY_MS) * DAY_MS - TAIPEI_OFFSET_MS;
}

/** The 14 Taiwan days before today, half-open, so today's games never change today's draw. */
export function favoriteWindow(now: number): { readonly from: number; readonly to: number } {
  const to = dayStart(now);
  return { from: to - FAVORITE_WINDOW_DAYS * DAY_MS, to };
}

export function recentGameCounts(
  matches: readonly { readonly finishedAt: number; readonly result: { readonly gameType: GameType } }[], now: number,
): RecentGameCounts {
  const { from, to } = favoriteWindow(now);
  const counts: Partial<Record<GameType, number>> = {};
  for (const { finishedAt, result: { gameType } } of matches) {
    if (finishedAt >= from && finishedAt < to) counts[gameType] = (counts[gameType] ?? 0) + 1;
  }
  return counts;
}

/** Most-played first; equal counts keep the catalog order so draws stay stable. */
export function favoriteGames(counts: RecentGameCounts): { readonly gameType: GameType; readonly count: number }[] {
  return GAME_TYPES.flatMap((gameType) => (counts[gameType] ?? 0) > 0 ? [{ gameType, count: counts[gameType]! }] : [])
    .sort((first, second) => second.count - first.count).slice(0, FAVORITE_GAME_LIMIT);
}

interface Candidate { readonly id: DailyTaskId; readonly weight: number; readonly favorite: boolean }

/** A stable per-seed draw: refresh/restart never rerolls an assignment. */
function weightedPick(candidates: readonly Candidate[], seed: string): Candidate | undefined {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let point = Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 12), 16) / 2 ** 48 * total;
  for (const candidate of candidates) {
    point -= candidate.weight;
    if (point < 0) return candidate;
  }
  return candidates.at(-1);
}

/** The favorite slot falls back to another any-game task without recent history or once its favorites are used. */
function slotCandidates(slot: DailyTaskPool, exclude: readonly DailyTaskId[], recent: RecentGames): Candidate[] {
  const open = (pool: 'play' | 'challenge'): Candidate[] => dailyTaskPool(pool)
    .filter((id) => !exclude.includes(id)).map((id) => ({ id, weight: 1, favorite: false }));
  if (slot !== 'favorite') return open(slot);
  const favorites = favoriteGames(recent())
    .map(({ gameType, count }) => ({ id: favoriteTaskFor(gameType), weight: count, favorite: true }))
    .filter(({ id }) => !exclude.includes(id));
  return favorites.length > 0 ? favorites : open('play');
}

function assignTasks(day: string, accountId: string, recent: RecentGames): {
  readonly taskIds: readonly DailyTaskId[]; readonly favoriteTask?: DailyTaskId;
} {
  const taskIds: DailyTaskId[] = [];
  let favoriteTask: DailyTaskId | undefined;
  for (const slot of DAILY_TASK_SLOTS) {
    const picked = weightedPick(slotCandidates(slot, taskIds, recent), `${day}:${accountId}:${slot}`)!;
    taskIds.push(picked.id);
    if (picked.favorite) favoriteTask = picked.id;
  }
  return { taskIds, favoriteTask };
}

export type DailyState = DailyRewardsRecord & {
  readonly taskIds: readonly DailyTaskId[]; readonly gameCounts: Readonly<Partial<Record<GameType, number>>>;
  readonly matches: number; readonly humanMatches: number;
};

function countedGames(counts: Readonly<Partial<Record<GameType, number>>>): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

export function dailyState(record: DailyRewardsRecord | undefined, now: number, accountId: string, recent: RecentGames): DailyState {
  const day = dailyDate(now);
  // Earlier days are dropped here, retired task IDs included; the next write replaces the stored record.
  const state: DailyRewardsRecord = record?.day === day ? record : {
    day, gameTypes: [], wins: 0, claimedTasks: [], checkInDays: record?.checkInDays ?? [],
  };
  const gameCounts = state.gameCounts ?? Object.fromEntries(state.gameTypes.map((type) => [type, 1]));
  const normalized = { ...state, gameCounts, humanMatches: state.humanMatches ?? 0,
    matches: state.matches ?? Math.min(MATCH_CAP, countedGames(gameCounts)) };
  if (state.taskIds) return { ...normalized, taskIds: state.taskIds };
  const assigned = assignTasks(day, accountId, recent);
  // Preserve already claimed rewards from the earlier two-task implementation.
  const taskIds = [...new Set([...state.claimedTasks, ...assigned.taskIds])].slice(0, DAILY_TASK_COUNT);
  return assigned.favoriteTask && taskIds.includes(assigned.favoriteTask)
    ? { ...normalized, taskIds, favoriteTask: assigned.favoriteTask } : { ...normalized, taskIds };
}

export function taskProgress(state: DailyRewardsRecord, id: DailyTaskId): number {
  const counts = state.gameCounts ?? {};
  let progress: number;
  switch (id) {
    case 'play-any-2': case 'play-any-3': case 'play-any-4':
      progress = state.matches ?? countedGames(counts);
      break;
    case 'win-two':
      progress = state.wins;
      break;
    case 'play-two-kinds': case 'play-variety':
      progress = state.gameTypes.length;
      break;
    case 'play-with-humans':
      progress = state.humanMatches ?? 0;
      break;
    case 'play-casino':
      progress = (counts.blackjack ?? 0) + (counts.holdem ?? 0) + (counts.tenhalf ?? 0) + (counts.stud ?? 0);
      break;
    default:
      progress = counts[dailyTaskGame(id)!] ?? 0;
  }
  return Math.min(dailyTask(id).target, progress);
}

/** Only an assigned, unclaimed task without progress may use the day's single free replacement. */
export function taskReplaceable(state: DailyRewardsRecord, id: DailyTaskId): boolean {
  return !state.replacement && Boolean(state.taskIds?.includes(id)) && !state.claimedTasks.includes(id)
    && taskProgress(state, id) === 0;
}

/** A task from the slot's pool that is not assigned today; undefined only if the pool is exhausted. */
export function replacementTask(state: DailyState, slot: number, accountId: string, recent: RecentGames): {
  readonly id: DailyTaskId; readonly favorite: boolean;
} | undefined {
  const pool = DAILY_TASK_SLOTS[slot];
  return pool && weightedPick(slotCandidates(pool, state.taskIds, recent), `${state.day}:${accountId}:replace`);
}

export function dailyStatus(
  record: DailyRewardsRecord | undefined, now: number, accountId: string, recent: RecentGames,
): DailyRewardsStatus {
  const state = dailyState(record, now, accountId, recent);
  return { day: state.day, gameTypes: state.gameTypes, wins: state.wins, claimedTasks: state.claimedTasks, serverTime: now,
    tasks: state.taskIds.map((id) => ({ id, progress: taskProgress(state, id), replaceable: taskReplaceable(state, id),
      ...(state.favoriteTask === id ? { favorite: true as const } : {}) })),
    swapsRemaining: state.replacement ? 0 : 1,
    resetsAt: dayStart(now) + DAY_MS,
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

/** Counts a completed game the account played as a human; bots may fill the other seats. */
export function dailyGameProgress(
  record: DailyRewardsRecord | undefined, game: Pick<AnyGameState, 'players' | 'gameType' | 'result'>, accountId: string,
  now: number, recent: RecentGames,
): DailyRewardsRecord {
  const state = dailyState(record, now, accountId, recent);
  const players: readonly PlayerInfo[] = Object.values(game.players);
  if (!game.result || !players.some((player) => player.id === accountId && !player.isBot)) return state;
  const withHuman = players.some((player) => player.id !== accountId && !player.isBot);
  return { ...state, gameTypes: [...new Set([...state.gameTypes, game.gameType])],
    gameCounts: { ...state.gameCounts, [game.gameType]: Math.min(GAME_COUNT_CAP, (state.gameCounts[game.gameType] ?? 0) + 1) },
    wins: Math.min(WIN_CAP, state.wins + Number(gameWonByAccount(game, accountId))),
    matches: Math.min(MATCH_CAP, state.matches + 1),
    humanMatches: Math.min(HUMAN_MATCH_CAP, state.humanMatches + Number(withHuman)) };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function optionalCount(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max);
}

/** Retired task IDs stay valid so records saved before the slot pools keep loading. */
export function validDailyRewards(value: unknown): value is DailyRewardsRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const valid = validDate(record.day)
    && Array.isArray(record.gameTypes) && record.gameTypes.every((type: unknown) => GAME_TYPES.some((game) => game === type))
    && new Set(record.gameTypes).size === record.gameTypes.length
    && typeof record.wins === 'number' && Number.isInteger(record.wins) && record.wins >= 0 && record.wins <= WIN_CAP
    && Array.isArray(record.claimedTasks) && record.claimedTasks.every(isDailyTaskId)
    && new Set(record.claimedTasks).size === record.claimedTasks.length
    && Array.isArray(record.checkInDays) && record.checkInDays.every(validDate)
    && new Set(record.checkInDays).size === record.checkInDays.length
    && optionalCount(record.matches, MATCH_CAP) && optionalCount(record.humanMatches, HUMAN_MATCH_CAP);
  if (!valid) return false;
  if (record.gameCounts !== undefined && (!record.gameCounts || typeof record.gameCounts !== 'object'
    || Array.isArray(record.gameCounts) || !Object.entries(record.gameCounts).every(([type, count]: [string, unknown]) =>
      GAME_TYPES.some((game) => game === type) && optionalCount(count, GAME_COUNT_CAP) && count !== undefined))) return false;
  if (record.taskIds !== undefined && (!Array.isArray(record.taskIds) || record.taskIds.length !== DAILY_TASK_COUNT
    || !record.taskIds.every(isDailyTaskId) || new Set(record.taskIds).size !== DAILY_TASK_COUNT
    || !(record.claimedTasks as DailyTaskId[]).every((id) => (record.taskIds as unknown[]).includes(id)))) return false;
  if (record.favoriteTask !== undefined && (!isDailyTaskId(record.favoriteTask) || !Array.isArray(record.taskIds)
    || !record.taskIds.includes(record.favoriteTask) || !dailyTaskPool('favorite').includes(record.favoriteTask))) return false;
  if (record.replacement !== undefined) {
    if (!record.replacement || typeof record.replacement !== 'object') return false;
    const replacement = record.replacement as Record<string, unknown>;
    if (!isDailyTaskId(replacement.from) || !isDailyTaskId(replacement.to) || replacement.from === replacement.to
      || !Array.isArray(record.taskIds) || record.taskIds.includes(replacement.from) || !record.taskIds.includes(replacement.to)) return false;
  }
  const state = value as DailyRewardsRecord;
  return state.claimedTasks.every((id) => taskProgress(state, id) >= dailyTask(id).target);
}
