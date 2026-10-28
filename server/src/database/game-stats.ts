import { GAME_TYPES } from '@shared/constants';
import { matchSeats, matchStanding } from '@shared/rules/match-standing';
import { countAccountMatch, countGameMatch, RECENT_RESULTS } from '@shared/stats/accumulate';
import { STATS_VERSION } from '@shared/stats/definitions';
import { finalReplayFrame, matchFacts } from '@shared/stats';
import type {
  AccountStats, GameStats, GameType, MatchReplay, PlayerStats, ReplaySnapshot, StatsScope,
} from '@shared/types';
import type { MatchRecord } from './repository';

export interface GameStatsRecord extends GameStats {
  readonly accountId: string;
  readonly scope: StatsScope;
}

export interface AccountStatsRecord extends AccountStats {
  readonly accountId: string;
  readonly scope: StatsScope;
}

/**
 * The schema v9 backfill's progress, present until it has counted every stored match. Matches count
 * in completion order, then by ID; `after` is the last counted one.
 */
export interface StatsBackfillState {
  readonly after: { readonly at: number; readonly matchId: string } | null;
}

export const STATS_SCOPES: readonly StatsScope[] = ['human', 'all'];

/** Matches without a bot count in both scopes; the rest only in `all`. */
export function matchScopes(accountIds: readonly string[]): readonly StatsScope[] {
  return accountIds.some((id) => id.startsWith('bot:')) ? ['all'] : STATS_SCOPES;
}

export function gameStatsKey(accountId: string, gameType: GameType, scope: StatsScope): string {
  return JSON.stringify([accountId, gameType, scope]);
}

export function accountStatsKey(accountId: string, scope: StatsScope): string {
  return JSON.stringify([accountId, scope]);
}

/** Reads committed records; a stage layers the uncommitted changes of one write over it. */
export interface StatsSource {
  game(accountId: string, gameType: GameType, scope: StatsScope): GameStatsRecord | null;
  account(accountId: string, scope: StatsScope): AccountStatsRecord | null;
}

export interface StatsStage extends StatsSource {
  /**
   * Counts one completed match for every human participant that has an account. `frame` is the final
   * replay frame, or null when the match was not recorded. `since` gives where counting starts for an
   * account without counters yet, when its older results were pruned.
   */
  count(match: MatchRecord, frame: ReplaySnapshot | null, since?: (accountId: string) => number | null): void;
  readonly games: ReadonlyMap<string, GameStatsRecord>;
  readonly accounts: ReadonlyMap<string, AccountStatsRecord>;
}

export function createStatsStage(source: StatsSource, isAccount: (accountId: string) => boolean): StatsStage {
  const games = new Map<string, GameStatsRecord>();
  const accounts = new Map<string, AccountStatsRecord>();
  const game = (accountId: string, gameType: GameType, scope: StatsScope): GameStatsRecord | null =>
    games.get(gameStatsKey(accountId, gameType, scope)) ?? source.game(accountId, gameType, scope);
  const account = (accountId: string, scope: StatsScope): AccountStatsRecord | null =>
    accounts.get(accountStatsKey(accountId, scope)) ?? source.account(accountId, scope);
  return {
    game, account, games, accounts,
    count: (match, frame, since) => {
      const seats = matchSeats(match.result);
      const scopes = matchScopes(match.accountIds);
      match.accountIds.forEach((accountId, index) => {
        const seat = seats[index];
        if (accountId.startsWith('bot:') || !seat || !isAccount(accountId)) return;
        const standing = matchStanding(match.result, seat);
        if (!standing) return;
        const facts = matchFacts(match.result, seat, frame);
        const { gameType } = match.result;
        for (const scope of scopes) {
          const previousAccount = account(accountId, scope);
          const counted = { gameType, matchId: match.id, at: match.finishedAt, standing, facts, logged: frame !== null,
            since: previousAccount ? previousAccount.since : since?.(accountId) ?? null };
          // The counters are pure over the record's fields; the keys are set again on the result.
          games.set(gameStatsKey(accountId, gameType, scope),
            { ...countGameMatch(game(accountId, gameType, scope), counted), accountId, scope });
          accounts.set(accountStatsKey(accountId, scope), { ...countAccountMatch(previousAccount, counted), accountId, scope });
        }
      });
    },
  };
}

/** The final frame of a validated archive; undefined archives count without log records. */
export function replayFrame(replay: MatchReplay | undefined): ReplaySnapshot | null {
  return replay ? finalReplayFrame(replay) : null;
}

// Validation of stored records.

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function signed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function optionalTime(value: unknown): boolean {
  return value === null || count(value);
}

const KEY = /^[A-Za-z0-9._-]{1,64}$/;

function numbers(value: unknown, valid: (entry: unknown) => boolean): boolean {
  return isObject(value) && Object.entries(value).every(([key, entry]) => KEY.test(key) && valid(entry));
}

function marks(value: unknown): boolean {
  return numbers(value, (entry) => isObject(entry) && signed(entry.value) && typeof entry.matchId === 'string'
    && entry.matchId.length > 0 && count(entry.at));
}

function streak(value: unknown): boolean {
  return isObject(value) && count(value.current) && count(value.best) && value.current <= value.best;
}

function scope(value: unknown): value is StatsScope {
  return value === 'human' || value === 'all';
}

export function validGameStats(value: unknown): value is GameStatsRecord {
  return isObject(value) && typeof value.accountId === 'string' && value.accountId.length > 0 && scope(value.scope) &&
    GAME_TYPES.includes(value.gameType as GameType) && count(value.version) && value.version >= 1 &&
    value.version <= STATS_VERSION && optionalTime(value.since) && numbers(value.versionSince, count) &&
    count(value.matches) && count(value.wins) && count(value.ties) && value.wins <= value.matches &&
    value.ties <= value.wins && Array.isArray(value.ranks) && value.ranks.length <= 8 && value.ranks.every(count) &&
    numbers(value.tables, count) && numbers(value.counts, count) && numbers(value.sums, signed) && marks(value.best) &&
    marks(value.latest) && streak(value.streak) && count(value.logged) && value.logged <= value.matches &&
    optionalTime(value.logSince) && count(value.lastAt);
}

export function validAccountStats(value: unknown): value is AccountStatsRecord {
  return isObject(value) && typeof value.accountId === 'string' && value.accountId.length > 0 && scope(value.scope) &&
    optionalTime(value.since) && streak(value.streak) && Array.isArray(value.recent) &&
    value.recent.length <= RECENT_RESULTS && value.recent.every((entry: unknown) => isObject(entry) &&
      GAME_TYPES.includes(entry.gameType as GameType) && typeof entry.matchId === 'string' && entry.matchId.length > 0 &&
      count(entry.at) && (entry.outcome === 'win' || entry.outcome === 'loss' || entry.outcome === 'tie')) &&
    count(value.lastAt);
}

export function validStatsBackfill(value: unknown): value is StatsBackfillState {
  return isObject(value) && Object.keys(value).length === 1 && (value.after === null || (isObject(value.after)
    && count(value.after.at) && typeof value.after.matchId === 'string' && value.after.matchId.length > 0));
}

// The API response.

export { napoleonRoleTotals } from './games/napoleon-stats';

function withoutKeys<T extends { readonly accountId: string; readonly scope: StatsScope }>(
  record: T,
): Omit<T, 'accountId' | 'scope'> {
  const { accountId: _accountId, scope: _scope, ...rest } = record;
  return rest;
}

export function playerStats(
  games: readonly GameStatsRecord[], accounts: readonly AccountStatsRecord[], napoleonRoles: PlayerStats['napoleonRoles'],
): PlayerStats {
  const scopeStats = (value: StatsScope): PlayerStats['scopes'][StatsScope] => {
    const account = accounts.find((entry) => entry.scope === value);
    return {
      account: account ? withoutKeys(account) : null,
      games: games.filter((entry) => entry.scope === value).map(withoutKeys)
        .sort((first, second) => GAME_TYPES.indexOf(first.gameType) - GAME_TYPES.indexOf(second.gameType)),
    };
  };
  return { version: STATS_VERSION, scopes: { human: scopeStats('human'), all: scopeStats('all') }, napoleonRoles };
}
