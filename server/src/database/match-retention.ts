import { MAX_MATCHES_PER_ACCOUNT } from './repository';
import type { MatchRecord } from './repository';

/** Equal completion times keep insertion order, matching the history index. Bots hold no slots. */
export function retainMatches(matches: readonly MatchRecord[]): MatchRecord[] {
  const counts = new Map<string, number>();
  const retained = new Set<string>();
  const newest = [...matches].sort((first, second) => second.finishedAt - first.finishedAt);
  for (const match of newest) {
    for (const id of match.accountIds) {
      if (id.startsWith('bot:')) continue;
      const count = counts.get(id) ?? 0;
      if (count < MAX_MATCHES_PER_ACCOUNT) retained.add(match.id);
      counts.set(id, count + 1);
    }
  }
  return matches.filter((match) => retained.has(match.id));
}
