import type { GameSeat, ReplaySnapshot } from '../types';
import type { GoFishMatchResult } from '../games/gofish/types';
import { gfLeaders } from '../rules/gofish';
import type { SeatFacts } from './facts';
import { factsBuilder, frameOf } from './facts';

/**
 * Hands with the most books (ties included) and the match's book total; from the log, cards received by asking
 * and draws that produced the asked rank.
 */
export function goFishFacts(result: GoFishMatchResult, seat: GameSeat, frame: ReplaySnapshot | null): SeatFacts {
  const facts = factsBuilder();
  const seats = result.seats ?? [];
  facts.count('handsWon', result.handBooks.filter((books) => gfLeaders(seats, books).includes(seat)).length);
  facts.value('topBooks', result.scores[seat]);
  for (const entry of frameOf(frame, 'gofish')?.log ?? []) {
    if (entry.type !== 'ask' || entry.seat !== seat) continue;
    facts.count('cardsTaken', entry.given);
    if (entry.fished === 'lucky') facts.count('luckyFishes');
  }
  return facts;
}
