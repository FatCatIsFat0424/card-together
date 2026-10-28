import type { AccountStatsRecord, GameStatsRecord, StatsSource, StatsStage } from './game-stats';
import { accountStatsKey, gameStatsKey } from './game-stats';
import type { DatabaseDocument } from './schema';

/** Published tables are immutable, so an index stays valid for as long as its array is current. */
const gameIndexes = new WeakMap<readonly GameStatsRecord[], Map<string, number>>();
const accountIndexes = new WeakMap<readonly AccountStatsRecord[], Map<string, number>>();

function positions<T>(cache: WeakMap<readonly T[], Map<string, number>>, records: readonly T[], key: (record: T) => string): Map<string, number> {
  let index = cache.get(records);
  if (!index) {
    index = new Map(records.map((record, position) => [key(record), position]));
    cache.set(records, index);
  }
  return index;
}

const gameKey = (record: GameStatsRecord): string => gameStatsKey(record.accountId, record.gameType, record.scope);
const accountKey = (record: AccountStatsRecord): string => accountStatsKey(record.accountId, record.scope);

/** Reads the counters of a JSON document. */
export function documentStatsSource(document: Pick<DatabaseDocument, 'gameStats' | 'accountStats'>): StatsSource {
  return {
    game: (accountId, gameType, scope) => {
      const position = positions(gameIndexes, document.gameStats, gameKey).get(gameStatsKey(accountId, gameType, scope));
      return position === undefined ? null : document.gameStats[position];
    },
    account: (accountId, scope) => {
      const position = positions(accountIndexes, document.accountStats, accountKey).get(accountStatsKey(accountId, scope));
      return position === undefined ? null : document.accountStats[position];
    },
  };
}

function merged<T>(
  cache: WeakMap<readonly T[], Map<string, number>>, records: readonly T[], key: (record: T) => string,
  changes: ReadonlyMap<string, T>,
): T[] {
  if (changes.size === 0) return records as T[];
  const index = positions(cache, records, key);
  const next = records.slice();
  for (const [changed, record] of changes) {
    const position = index.get(changed);
    if (position === undefined) next.push(record);
    else next[position] = record;
  }
  return next;
}

/** Applies a stage's counters to the document being written. */
export function applyStatsStage(data: DatabaseDocument, stage: StatsStage): void {
  data.gameStats = merged(gameIndexes, data.gameStats, gameKey, stage.games);
  data.accountStats = merged(accountIndexes, data.accountStats, accountKey, stage.accounts);
}
