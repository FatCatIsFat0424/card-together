import { GAME_SEAT_ORDER, GAME_TYPES } from '@shared/constants';
import { matchStanding } from '@shared/rules/match-standing';
import type { GameSeat, GameType, MatchResult } from '@shared/types';
import { achievementState, validAchievements } from './achievements';

type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Stored documents are unvalidated here, so a malformed result counts as no win instead of aborting the migration. */
function wonSeat(result: JsonObject, seat: string): boolean {
  try {
    return matchStanding(result as unknown as MatchResult, seat as GameSeat)?.won ?? false;
  } catch {
    return false;
  }
}

/** v7: recover retained history once; never add overlapping legacy counters twice. */
export function backfillAchievementCounts(document: JsonObject): JsonObject {
  if (!Array.isArray(document.accounts)) return document;
  const totals = new Map<string, { games: number; wins: number; types: Set<GameType> }>();
  for (const account of document.accounts) {
    if (object(account) && typeof account.id === 'string') totals.set(account.id, { games: 0, wins: 0, types: new Set() });
  }
  const counted = new Set<string>();
  function count(id: unknown, type: unknown, result: unknown, seats: readonly (readonly [string, unknown])[]): void {
    const gameType = GAME_TYPES.find((game) => game === type);
    if (typeof id !== 'string' || counted.has(id) || !object(result) || !gameType) return;
    counted.add(id);
    for (const [seat, accountId] of seats) {
      const total = typeof accountId === 'string' ? totals.get(accountId) : undefined;
      if (!total) continue;
      // Same rule as live play and daily rewards: first place (ties included) or the winning side.
      const won = wonSeat({ ...result, gameType }, seat);
      total.games++;
      total.wins += Number(won);
      total.types.add(gameType);
    }
  }
  for (const match of Array.isArray(document.matches) ? document.matches : []) {
    if (!object(match) || !object(match.result) || !Array.isArray(match.accountIds)) continue;
    const participants = match.result.seats;
    const accountIds: unknown[] = match.accountIds;
    const seats = Array.isArray(participants)
      ? GAME_SEAT_ORDER.filter((seat) => participants.includes(seat)) : GAME_SEAT_ORDER.slice(0, 4);
    count(match.id, match.result.gameType, match.result, seats.map((seat, index) => [seat, accountIds[index]]));
  }
  const rewarded = new Set(Array.isArray(document.rewardedGameIds) ? document.rewardedGameIds : []);
  const runtime = document.runtime;
  if (object(runtime) && Array.isArray(runtime.games)) {
    for (const game of runtime.games) {
      // Only committed completions: unfinished/unrewarded runtime games still use the normal writer.
      if (!object(game) || !rewarded.has(game.id) || !object(game.players)) continue;
      count(game.id, game.gameType, game.result, Object.entries(game.players).flatMap(([seat, player]) =>
        object(player) && !player.isBot ? [[seat, player.id] as const] : []));
    }
  }
  return { ...document, accounts: document.accounts.map((account: unknown) => {
    if (!object(account) || typeof account.id !== 'string') return account;
    // Leave invalid records untouched so normal document validation rejects them.
    if (account.achievements !== undefined && !validAchievements(account.achievements)) return account;
    const old = achievementState(account.achievements);
    const total = totals.get(account.id)!;
    if (total.games === 0) return account;
    const gameTypes = [...new Set([...old.gameTypes, ...total.types])];
    return { ...account, achievements: { ...old, games: Math.max(old.games, total.games, gameTypes.length),
      wins: Math.max(old.wins, total.wins), gameTypes } };
  }) };
}
