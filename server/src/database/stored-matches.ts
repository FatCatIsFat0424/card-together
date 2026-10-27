import { isReplayRecordId } from '@shared/replay-session';
import type { MatchReplay } from '@shared/types';
import { isMatchReplay } from './match-replay';
import type { MatchRecord, NewMatchRecord } from './repository';
import { repositoryError } from './repository';
import { isObject } from './schema';

/** Splits incoming matches into stored records and the archives to write; later duplicates win. */
export function storedMatches(matches: readonly NewMatchRecord[]): { records: MatchRecord[]; archives: Map<string, MatchReplay> } {
  const records: MatchRecord[] = [];
  const archives = new Map<string, MatchReplay>();
  for (const match of matches) {
    // Only a stored archive sets the flag, whatever the caller passed.
    const { replay, hasReplay: _hasReplay, ...fields } = structuredClone(match) as NewMatchRecord & { readonly hasReplay?: unknown };
    if (replay === undefined) {
      archives.delete(fields.id);
      records.push(fields);
      continue;
    }
    if (!isReplayRecordId(fields.id) || !isObject(fields.result) || !isMatchReplay(replay, fields.result, fields.finishedAt)) {
      throw repositoryError('INVALID_REPLAY', 'Invalid match replay archive.');
    }
    archives.set(fields.id, replay);
    records.push({ ...fields, hasReplay: true });
  }
  return { records, archives };
}
