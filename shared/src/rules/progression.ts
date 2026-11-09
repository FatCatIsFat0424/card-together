import {
  COLLECTION_STAMP_TARGETS, EXPERIENCE_PER_GAME, FAMILIARITY_TARGETS, MAX_PLAYER_LEVEL, PROGRESSION_GAME_TYPES, PROGRESSION_REWARDS,
} from '../constants/progression';
import type { CollectionEntryId, ProgressionGameType } from '../constants/progression';
import { STATS_RECORDS } from '../stats/definitions';
import type { GameStats, ProgressionStatus } from '../types';

const COLLECTION_ENTRIES = [
  { gameType: 'bigtwo', recordId: 'fullHouses', rare: false },
  { gameType: 'liarsdice', recordId: 'callsWon', rare: false },
  { gameType: 'liarsdice', recordId: 'bidsHeld', rare: false },
  { gameType: 'bigtwo', recordId: 'dragons', rare: true },
  { gameType: 'bigtwo', recordId: 'straightFlushes', rare: true },
  { gameType: 'bigtwo', recordId: 'fourOfAKinds', rare: true },
  { gameType: 'liarsdice', recordId: 'exactBids', rare: true },
] as const satisfies readonly { gameType: ProgressionGameType; recordId: string; rare: boolean }[];

function levelStatus(games: number): ProgressionStatus['level'] {
  if (!Number.isSafeInteger(games) || games < 0) throw new RangeError('Games must be a nonnegative safe integer.');
  let level = 1;
  while (level < MAX_PLAYER_LEVEL && games >= level * (level + 1) / 2) level++;
  const totalXp = (BigInt(games) * BigInt(EXPERIENCE_PER_GAME)).toString();
  if (level === MAX_PLAYER_LEVEL) {
    return { level, games, totalXp, currentLevelXp: 0, nextLevelXp: null, gamesToNextLevel: null };
  }
  const currentGames = games - level * (level - 1) / 2;
  return { level, games, totalXp, currentLevelXp: currentGames * EXPERIENCE_PER_GAME,
    nextLevelXp: level * EXPERIENCE_PER_GAME, gamesToNextLevel: level - currentGames };
}

/** Derives owner progress from lifetime achievements and already-selected all-scope statistics. */
export function progressionStatus(games: number, stats: readonly GameStats[], owned: readonly string[]): ProgressionStatus {
  const level = levelStatus(games);
  const familiarity = PROGRESSION_GAME_TYPES.map((gameType) => {
    const row = stats.find((entry) => entry.gameType === gameType);
    const games = row?.matches ?? 0;
    return { gameType, games, stage: FAMILIARITY_TARGETS.filter((target) => games >= target).length,
      nextTarget: FAMILIARITY_TARGETS.find((target) => games < target) ?? null, since: row?.since ?? null };
  });
  const collection = COLLECTION_ENTRIES.map(({ gameType, recordId, rare }) => {
    const row = stats.find((entry) => entry.gameType === gameType);
    const definition = STATS_RECORDS[gameType].find((entry) => entry.id === recordId)!;
    const tracked = row !== undefined && row.version >= definition.version
      && (definition.source !== 'log' || row.logged > 0);
    const count = tracked ? row.counts[recordId] ?? 0 : null;
    const starts = row ? [row.since, row.versionSince[String(definition.version)] ?? null,
      definition.source === 'log' ? row.logSince : null].filter((value): value is number => value !== null) : [];
    return { id: `${gameType}.${recordId}` as CollectionEntryId, gameType, recordId, rare, count, tracked,
      stamps: count === null ? 0 : rare ? Number(count >= 1) : COLLECTION_STAMP_TARGETS.filter((target) => count >= target).length,
      since: starts.length > 0 ? Math.max(...starts) : null };
  });
  const stamps = collection.reduce((total, entry) => total + (entry.rare ? 0 : entry.stamps), 0);
  const rewards = PROGRESSION_REWARDS.map((reward) => ({ id: reward.id,
    eligible: reward.kind === 'level' ? level.level >= reward.target
      : reward.kind === 'collection' ? stamps >= reward.target
        : familiarity.some((entry) => entry.gameType === reward.gameType && entry.games >= reward.target),
    claimed: owned.includes(reward.nameplate),
  }));
  return { level, familiarity, collection, stamps, rewards };
}
