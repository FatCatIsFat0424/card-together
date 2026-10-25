import type { MatchSummary } from '@shared/types';
import type { MatchRecord } from '../database/repository';

/** Keep stored archives out of list responses, including fields added to records later. */
export function matchSummary(match: MatchRecord): MatchSummary {
  return {
    id: match.id,
    roomCode: match.roomCode,
    accountIds: match.accountIds,
    result: match.result,
    finishedAt: match.finishedAt,
    ...(match.hasReplay ? { hasReplay: true } : {}),
  };
}
