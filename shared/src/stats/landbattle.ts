import type { GameSeat, LandBattleMatchResult, ReplaySnapshot } from '../types';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * Flag captures and the fewest moves one took, the most own pieces left at the end, attacks won, and enemy
 * marshals brought down (public: their flag is shown at that moment). Battles publish only their outcome,
 * so no record depends on a hidden identity.
 */
export function landBattleFacts(result: LandBattleMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  if (result.reason === 'flag-captured' && result.winners.includes(seat)) {
    facts.count('flagCaptures');
    facts.value('fastestWin', result.moves);
  }
  facts.value('mostSurvivors', result.remaining[seat] ?? 0);
  for (const entry of frameOf(frame, 'landbattle')?.log ?? []) {
    if (entry.seat !== seat) continue;
    if (entry.battle === 'win') facts.count('battlesWon');
    if (entry.flagShown?.some((shown) => shown !== seat)) facts.count('marshalsDowned');
  }
  return facts;
}
