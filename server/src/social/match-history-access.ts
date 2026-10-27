import type { MatchReplay, PublicAccount } from '@shared/types';
import type { AccountRecord, MatchRecord, Repository } from '../database/repository';
import { publicProfile } from './friend-service';

/** A subject's history is visible to its owner, or to other signed-in players while public. */
export function canViewMatchHistory(viewerId: string, subject: Pick<AccountRecord, 'id' | 'matchesPublic'>): boolean {
  return subject.id === viewerId || subject.matchesPublic === true;
}

export type MatchReplayLookup =
  | { readonly status: 'found'; readonly match: MatchRecord; readonly replay: MatchReplay }
  | { readonly status: 'playerNotFound' | 'private' | 'replayNotFound' };

/** Public messages that match the existing history routes. */
export const MATCH_REPLAY_ERRORS = {
  playerNotFound: 'Player not found.',
  private: 'Match history is private.',
  replayNotFound: 'Match replay not found.',
} as const satisfies Record<Exclude<MatchReplayLookup['status'], 'found'>, string>;

/**
 * Finds a recorded match in the subject's retained history, so unrelated and expired match IDs stay
 * inaccessible. A null viewer skips the history permission, for callers that already checked it.
 * Pruned, missing, or corrupt archives read as not found.
 */
export async function findMatchReplay(
  repository: Repository, viewerId: string | null, subjectId: string, matchId: string,
): Promise<MatchReplayLookup> {
  const subject = await repository.getAccountById(subjectId);
  if (!subject) return { status: 'playerNotFound' };
  if (viewerId !== null && !canViewMatchHistory(viewerId, subject)) return { status: 'private' };
  const match = (await repository.listMatches(subject.id)).find((entry) => entry.id === matchId);
  const replay = match?.hasReplay ? await repository.getMatchReplay(match.id) : undefined;
  return match && replay ? { status: 'found', match, replay } : { status: 'replayNotFound' };
}

/** Public profiles of the listed matches' accounts that still exist. */
export async function matchPlayers(
  repository: Repository, matches: readonly Pick<MatchRecord, 'accountIds'>[],
): Promise<Record<string, PublicAccount>> {
  const players: Record<string, PublicAccount> = {};
  for (const id of new Set(matches.flatMap((match) => match.accountIds))) {
    const player = await repository.getAccountById(id);
    if (player) players[id] = publicProfile(player);
  }
  return players;
}
